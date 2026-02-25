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

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Nextcloud Talk Bridge
// ---------------------------------------------------------------------------

const NC_TALK_MAX_LENGTH = 32000;
const POLL_INTERVAL_MS = 3000;

export interface NextcloudTalkConfig {
  serverUrl: string;
  username: string;
  appPassword: string;
}

interface PendingResponse {
  conversationToken: string;
  conversationId: string;
}

interface NcTalkMessage {
  id: number;
  actorType: string;
  actorId: string;
  actorDisplayName: string;
  message: string;
  timestamp: number;
  token: string;
  messageType: string;
  systemMessage: string;
}

interface NcTalkRoom {
  token: string;
  name: string;
  displayName: string;
  type: number; // 1=one-to-one, 2=group, 3=public, 4=changelog
  lastMessage?: NcTalkMessage;
}

export class NextcloudTalkBridge {
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private config: NextcloudTalkConfig | null = null;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{nextcloudUserId}:{roomToken}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → roomToken for sending responses */
  private channelMap = new Map<string, string>();
  private pendingResponses = new Map<string, PendingResponse>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  /** Track last known message ID per room to only fetch new messages */
  private lastKnownMessageId = new Map<string, number>();

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: NextcloudTalkConfig): Promise<void> {
    if (this.polling) {
      await this.stop();
    }

    this.config = config;

    // Validate credentials by fetching current user
    const authHeader = this.getAuthHeader();
    const res = await fetch(`${config.serverUrl}/ocs/v2.php/cloud/user`, {
      headers: {
        Authorization: authHeader,
        "OCS-APIRequest": "true",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`Nextcloud Talk auth failed: HTTP ${res.status}`);
    }

    const userData = (await res.json()) as {
      ocs?: { data?: { id?: string; displayname?: string } };
    };
    const displayName = userData.ocs?.data?.displayname ?? config.username;

    this.polling = true;
    console.log(`[Nextcloud Talk] Connected as ${displayName}`);
    this.io.emit("nextcloud-talk:status", {
      status: "connected",
      botUsername: displayName,
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    // Start polling for new messages
    this.schedulePoll();
  }

  async stop(): Promise<void> {
    this.polling = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.pendingResponses.clear();

    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    if (this.config) {
      this.io.emit("nextcloud-talk:status", { status: "disconnected" });
    }

    this.config = null;
  }

  async getJoinedRooms(): Promise<NcTalkRoom[]> {
    if (!this.config) return [];

    try {
      const res = await fetch(
        `${this.config.serverUrl}/ocs/v2.php/apps/spreed/api/v4/room`,
        {
          headers: {
            Authorization: this.getAuthHeader(),
            "OCS-APIRequest": "true",
            Accept: "application/json",
          },
        },
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { ocs?: { data?: NcTalkRoom[] } };
      return data.ocs?.data ?? [];
    } catch (err) {
      console.error("[Nextcloud Talk] Error fetching rooms:", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  private schedulePoll(): void {
    if (!this.polling || this.pollTimer) return;
    this.pollTimer = setTimeout(async () => {
      this.pollTimer = null;
      await this.pollMessages();
      if (this.polling) {
        this.schedulePoll();
      }
    }, POLL_INTERVAL_MS);
  }

  private async pollMessages(): Promise<void> {
    if (!this.config) return;

    try {
      const rooms = await this.getJoinedRooms();

      // Check allowed conversations filter
      const raw = getConfig("nextcloud-talk:allowed_conversations");
      let allowedConversations: string[] = [];
      if (raw) {
        try { allowedConversations = JSON.parse(raw); } catch { /* ignore */ }
      }

      for (const room of rooms) {
        // Skip changelog rooms
        if (room.type === 4) continue;

        // If allowed conversations list is set and non-empty, filter
        if (allowedConversations.length > 0 && !allowedConversations.includes(room.token)) {
          // Always allow 1-to-1 conversations (DMs)
          if (room.type !== 1) continue;
        }

        await this.pollRoomMessages(room);
      }
    } catch (err) {
      console.error("[Nextcloud Talk] Poll error:", err);
      this.io.emit("nextcloud-talk:status", { status: "error" });
    }
  }

  private async pollRoomMessages(room: NcTalkRoom): Promise<void> {
    if (!this.config) return;

    const lastKnown = this.lastKnownMessageId.get(room.token) ?? 0;

    try {
      // Use lookIntoFuture=1 with lastKnownMessageId to get only new messages
      let url = `${this.config.serverUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${room.token}?limit=100&setReadMarker=0`;
      if (lastKnown > 0) {
        url += `&lookIntoFuture=1&lastKnownMessageId=${lastKnown}`;
      } else {
        // First poll: get last few messages to establish baseline
        url += `&lookIntoFuture=0`;
      }

      const res = await fetch(url, {
        headers: {
          Authorization: this.getAuthHeader(),
          "OCS-APIRequest": "true",
          Accept: "application/json",
        },
      });

      // 304 = no new messages
      if (res.status === 304) return;
      if (!res.ok) return;

      const data = (await res.json()) as {
        ocs?: { data?: NcTalkMessage[] };
      };
      const messages = data.ocs?.data ?? [];

      if (messages.length === 0) return;

      // Update last known message ID
      const maxId = Math.max(...messages.map((m) => m.id));
      this.lastKnownMessageId.set(room.token, maxId);

      // On first poll, just record the baseline — don't process old messages
      if (lastKnown === 0) return;

      // Process new messages
      for (const msg of messages) {
        await this.handleMessage(msg, room);
      }
    } catch (err) {
      console.error(`[Nextcloud Talk] Error polling room ${room.token}:`, err);
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: Nextcloud Talk → COO
  // -------------------------------------------------------------------------

  private async handleMessage(msg: NcTalkMessage, room: NcTalkRoom): Promise<void> {
    // Ignore system messages
    if (msg.systemMessage) return;

    // Ignore own messages
    if (msg.actorId === this.config?.username) return;

    // Ignore non-user messages (bots, guests, etc. unless actorType is "users")
    if (msg.actorType !== "users") return;

    const isDM = room.type === 1;
    const requireMention = getConfig("nextcloud-talk:require_mention") !== "false";
    const botUsername = this.config?.username;

    // In group/public rooms, only respond to @mentions (unless require_mention is off)
    if (!isDM && requireMention) {
      if (!botUsername || !msg.message.includes(`@${botUsername}`)) {
        return;
      }
    }

    const nextcloudUserId = msg.actorId;
    const nextcloudDisplayName = msg.actorDisplayName || msg.actorId;

    // Check pairing
    if (!isPaired(nextcloudUserId)) {
      const code = generatePairingCode(nextcloudUserId, nextcloudDisplayName);
      await this.sendMessage(
        room.token,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n**\`${code}\`**\n\nThis code expires in 1 hour.`,
      );
      this.io.emit("nextcloud-talk:pairing-request", {
        code,
        nextcloudUserId,
        nextcloudDisplayName,
      });
      return;
    }

    // Extract content — strip bot mention if present
    let content = msg.message;
    if (botUsername) {
      content = content.replace(new RegExp(`@${botUsername}\\b`, "g"), "").trim();
    }
    if (!content) return;

    // Route to COO
    await this.routeToCOO(room.token, nextcloudUserId, nextcloudDisplayName, content);
  }

  private async routeToCOO(
    roomToken: string,
    nextcloudUserId: string,
    nextcloudDisplayName: string,
    content: string,
  ): Promise<void> {
    const convKey = `${nextcloudUserId}:${roomToken}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Nextcloud Talk: ${nextcloudDisplayName} — ${content.slice(0, 60)}`;
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

    this.channelMap.set(conversationId, roomToken);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      conversationToken: roomToken,
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
        source: "nextcloud-talk",
        nextcloudUserId,
        nextcloudRoomToken: roomToken,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Nextcloud Talk
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        this.pendingResponses.delete(conversationId);
        this.sendReply(pending.conversationToken, message.content).catch((err) => {
          console.error("[Nextcloud Talk] Error sending reply:", err);
        });
        return;
      }

      // Unsolicited message to a known Nextcloud Talk room
      const roomToken = this.channelMap.get(conversationId);
      if (roomToken) {
        this.sendReply(roomToken, message.content).catch((err) => {
          console.error("[Nextcloud Talk] Error sending unsolicited message:", err);
        });
        return;
      }
    }
  }

  private async sendReply(roomToken: string, content: string): Promise<void> {
    const chunks = splitMessage(content, NC_TALK_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.sendMessage(roomToken, chunk);
    }
  }

  async sendMessage(roomToken: string, message: string): Promise<void> {
    if (!this.config) return;

    const res = await fetch(
      `${this.config.serverUrl}/ocs/v2.php/apps/spreed/api/v1/chat/${roomToken}`,
      {
        method: "POST",
        headers: {
          Authorization: this.getAuthHeader(),
          "OCS-APIRequest": "true",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ message }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to send message: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private getAuthHeader(): string {
    if (!this.config) return "";
    return "Basic " + Buffer.from(`${this.config.username}:${this.config.appPassword}`).toString("base64");
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
