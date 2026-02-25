import WebSocket from "ws";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";
import { isPaired, generatePairingCode, listPairedUsers } from "./pairing.js";
import type { MattermostAvailableChannel } from "./mattermost-settings.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Mattermost Bridge
// ---------------------------------------------------------------------------

const MM_MAX_LENGTH = 16383;

export interface MattermostConfig {
  serverUrl: string;
  token: string;
  defaultTeam?: string;
}

interface PendingResponse {
  channelId: string;
  postId: string;
  rootId: string;
  conversationId: string;
}

export class MattermostBridge {
  private ws: WebSocket | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private config: MattermostConfig | null = null;
  private botUserId: string | null = null;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{mattermostUserId}:{channelId}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → { channelId, rootId } for sending responses */
  private channelMap = new Map<string, { channelId: string; rootId: string }>();
  private pendingResponses = new Map<string, PendingResponse>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private seqNum = 1;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: MattermostConfig): Promise<void> {
    if (this.ws) {
      await this.stop();
    }

    this.config = config;

    // Validate token by fetching bot user
    const meRes = await fetch(`${config.serverUrl}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });

    if (!meRes.ok) {
      throw new Error(`Mattermost auth failed: HTTP ${meRes.status}`);
    }

    const me = (await meRes.json()) as { id: string; username: string };
    this.botUserId = me.id;

    // Open WebSocket
    const wsUrl = config.serverUrl.replace(/^http/, "ws") + "/api/v4/websocket";
    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      // Authenticate over WebSocket
      this.ws!.send(JSON.stringify({
        seq: this.seqNum++,
        action: "authentication_challenge",
        data: { token: config.token },
      }));

      console.log(`[Mattermost] Connected as ${me.username}`);
      this.io.emit("mattermost:status", {
        status: "connected",
        botUsername: me.username,
      });
    });

    this.ws.on("message", (raw: WebSocket.Data) => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.event === "posted") {
          this.handlePostedEvent(event).catch((err) => {
            console.error("[Mattermost] Error handling posted event:", err);
          });
        }
      } catch { /* ignore non-JSON frames */ }
    });

    this.ws.on("close", () => {
      console.log("[Mattermost] WebSocket closed");
      this.io.emit("mattermost:status", { status: "disconnected" });
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      console.error("[Mattermost] WebSocket error:", error);
      this.io.emit("mattermost:status", { status: "error" });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.pendingResponses.clear();

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
      this.io.emit("mattermost:status", { status: "disconnected" });
    }

    this.config = null;
    this.botUserId = null;
  }

  async getAvailableChannels(): Promise<MattermostAvailableChannel[]> {
    if (!this.config || !this.botUserId) return [];

    const defaultTeam = getConfig("mattermost:default_team");
    if (!defaultTeam) return [];

    try {
      // Resolve team name → team ID
      const teamRes = await fetch(
        `${this.config.serverUrl}/api/v4/teams/name/${encodeURIComponent(defaultTeam)}`,
        { headers: { Authorization: `Bearer ${this.config.token}` } },
      );
      if (!teamRes.ok) return [];
      const team = (await teamRes.json()) as { id: string; display_name: string };

      // Fetch channels the bot belongs to
      const chRes = await fetch(
        `${this.config.serverUrl}/api/v4/users/${this.botUserId}/teams/${team.id}/channels`,
        { headers: { Authorization: `Bearer ${this.config.token}` } },
      );
      if (!chRes.ok) return [];
      const channels = (await chRes.json()) as Array<{
        id: string;
        name: string;
        display_name: string;
        type: string;
      }>;

      return channels
        .filter((ch) => ch.type === "O" || ch.type === "P") // public or private, not DMs
        .map((ch) => ({
          id: ch.id,
          name: ch.name,
          displayName: ch.display_name,
          teamName: team.display_name,
        }));
    } catch (err) {
      console.error("[Mattermost] Error fetching channels:", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: Mattermost → COO
  // -------------------------------------------------------------------------

  private async handlePostedEvent(event: {
    data?: { post?: string; channel_type?: string };
  }): Promise<void> {
    if (!event.data?.post) return;

    let post: {
      id: string;
      user_id: string;
      channel_id: string;
      message: string;
      root_id: string;
      props?: { from_bot?: string; override_username?: string };
    };
    try {
      post = JSON.parse(event.data.post);
    } catch {
      return;
    }

    // Ignore own messages
    if (post.user_id === this.botUserId) return;

    // Ignore bot posts
    if (post.props?.from_bot === "true") return;

    const isDM = event.data.channel_type === "D";
    const requireMention = getConfig("mattermost:require_mention") !== "false";

    // In channels, only respond to @mentions (unless require_mention is off)
    if (!isDM && requireMention) {
      const botUsername = getConfig("mattermost:bot_username");
      if (!botUsername || !post.message.includes(`@${botUsername}`)) {
        return;
      }
    }

    // Channel whitelist: if set, only respond in allowed channels (DMs always allowed)
    if (!isDM) {
      const raw = getConfig("mattermost:allowed_channels");
      if (raw) {
        try {
          const allowed: string[] = JSON.parse(raw);
          if (allowed.length > 0 && !allowed.includes(post.channel_id)) {
            return;
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const mattermostUserId = post.user_id;

    // Fetch username for pairing
    let mattermostUsername = mattermostUserId;
    if (this.config) {
      try {
        const userRes = await fetch(
          `${this.config.serverUrl}/api/v4/users/${mattermostUserId}`,
          { headers: { Authorization: `Bearer ${this.config.token}` } },
        );
        if (userRes.ok) {
          const user = (await userRes.json()) as { username: string };
          mattermostUsername = user.username;
        }
      } catch { /* use ID as fallback */ }
    }

    // Check pairing
    if (!isPaired(mattermostUserId)) {
      const code = generatePairingCode(mattermostUserId, mattermostUsername);
      await this.createPost(
        post.channel_id,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n**\`${code}\`**\n\nThis code expires in 1 hour.`,
        post.root_id || post.id,
      );
      this.io.emit("mattermost:pairing-request", {
        code,
        mattermostUserId,
        mattermostUsername,
      });
      return;
    }

    // Extract content — strip bot mention if present
    let content = post.message;
    const botUsername = getConfig("mattermost:bot_username");
    if (botUsername) {
      content = content.replace(new RegExp(`@${botUsername}\\b`, "g"), "").trim();
    }
    if (!content) return;

    // Route to COO
    await this.routeToCOO(post, mattermostUserId, mattermostUsername, content);
  }

  private async routeToCOO(
    post: { id: string; channel_id: string; root_id: string },
    mattermostUserId: string,
    mattermostUsername: string,
    content: string,
  ): Promise<void> {
    const channelId = post.channel_id;
    const convKey = `${mattermostUserId}:${channelId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Mattermost: ${mattermostUsername} — ${content.slice(0, 60)}`;
      const conversation: Conversation = {
        id: conversationId,
        title,
        projectId: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.conversations).values(conversation).run();
      this.coo.startNewConversation(conversationId, null, null);
      this.io.emit("conversation:created", conversation);
      this.conversationMap.set(convKey, conversationId);
    } else {
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    const rootId = post.root_id || post.id;
    this.channelMap.set(conversationId, { channelId, rootId });

    // Track pending response
    this.pendingResponses.set(conversationId, {
      channelId,
      postId: post.id,
      rootId,
      conversationId,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "mattermost",
        mattermostUserId,
        mattermostChannelId: channelId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Mattermost
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        this.pendingResponses.delete(conversationId);
        this.sendReply(pending.channelId, message.content, pending.rootId).catch((err) => {
          console.error("[Mattermost] Error sending reply:", err);
        });
        return;
      }

      // Unsolicited message to a known Mattermost channel
      const target = this.channelMap.get(conversationId);
      if (target) {
        this.sendReply(target.channelId, message.content, target.rootId).catch((err) => {
          console.error("[Mattermost] Error sending unsolicited message:", err);
        });
        return;
      }
    }

    // Fallback: send to first paired user as DM
    this.sendFallbackDM(message.content).catch((err) => {
      console.error("[Mattermost] Error sending DM fallback:", err);
    });
  }

  private async sendFallbackDM(content: string): Promise<void> {
    if (!this.config || !this.botUserId) return;

    const paired = listPairedUsers();
    if (paired.length === 0) {
      console.warn("[Mattermost] DM fallback: no paired users");
      return;
    }

    try {
      // Create or get DM channel
      const res = await fetch(`${this.config.serverUrl}/api/v4/channels/direct`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([this.botUserId, paired[0]!.mattermostUserId]),
      });
      if (!res.ok) return;
      const dm = (await res.json()) as { id: string };
      await this.sendReply(dm.id, content);
    } catch (err) {
      console.error("[Mattermost] DM fallback error:", err);
    }
  }

  private async sendReply(
    channelId: string,
    content: string,
    rootId?: string,
  ): Promise<void> {
    if (!this.config) return;

    const chunks = splitMessage(content, MM_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.createPost(channelId, chunk, rootId);
    }
  }

  private async createPost(
    channelId: string,
    message: string,
    rootId?: string,
  ): Promise<void> {
    if (!this.config) return;

    const body: Record<string, string> = {
      channel_id: channelId,
      message,
    };
    if (rootId) {
      body.root_id = rootId;
    }

    const res = await fetch(`${this.config.serverUrl}/api/v4/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create post: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Reconnect
  // -------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (!this.config || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.config) {
        console.log("[Mattermost] Attempting reconnect...");
        this.start(this.config).catch((err) => {
          console.error("[Mattermost] Reconnect failed:", err);
          this.scheduleReconnect();
        });
      }
    }, 5000);
  }
}

// ---------------------------------------------------------------------------
// Message splitting
// ---------------------------------------------------------------------------

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try to split at paragraph boundary
    const paragraphIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (paragraphIdx > maxLength * 0.3) {
      splitIdx = paragraphIdx;
    }

    // Try sentence boundary
    if (splitIdx === -1) {
      const sentenceMatch = remaining.slice(0, maxLength).match(/.*[.!?]\s/s);
      if (sentenceMatch) {
        splitIdx = sentenceMatch[0].length;
      }
    }

    // Hard cut at newline
    if (splitIdx === -1) {
      const newlineIdx = remaining.lastIndexOf("\n", maxLength);
      if (newlineIdx > maxLength * 0.3) {
        splitIdx = newlineIdx;
      }
    }

    // Final fallback: hard cut
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
