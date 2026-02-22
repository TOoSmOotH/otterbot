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
import { isPaired, generatePairingCode } from "./pairing.js";
import type { SlackAvailableChannel } from "./slack-settings.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Slack Bridge
// ---------------------------------------------------------------------------

const SLACK_MAX_LENGTH = 4000;

interface PendingResponse {
  channelId: string;
  threadTs?: string;
  conversationId: string;
}

export class SlackBridge {
  private app: unknown | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{slackUserId}:{channelId}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Cached Bolt module */
  private bolt: typeof import("@slack/bolt") | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: {
    botToken: string;
    signingSecret: string;
    appToken: string;
  }): Promise<void> {
    if (this.app) {
      await this.stop();
    }

    // Dynamic import so the rest of the codebase isn't affected when
    // @slack/bolt is not installed.
    const bolt = await import("@slack/bolt");
    this.bolt = bolt;

    const app = new bolt.App({
      token: config.botToken,
      signingSecret: config.signingSecret,
      appToken: config.appToken,
      socketMode: true,
    });

    // Handle messages
    app.message(async ({ message, say }) => {
      await this.handleMessage(message, say);
    });

    // Handle app_mention events (when bot is mentioned in channels)
    app.event("app_mention", async ({ event, say }) => {
      await this.handleAppMention(event, say);
    });

    // Handle reaction_added events
    app.event("reaction_added", async ({ event }) => {
      await this.handleReactionAdded(event);
    });

    // Handle slash commands — /otterbot
    app.command("/otterbot", async ({ command, ack, say }) => {
      await ack();
      await this.handleSlashCommand(command, say);
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    await app.start();
    this.app = app;

    console.log("[Slack] Bridge started");
    this.io.emit("slack:status", { status: "connected" });
  }

  async stop(): Promise<void> {
    this.pendingResponses.clear();

    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    if (this.app) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.app as any).stop();
      this.app = null;
      this.bolt = null;
      this.io.emit("slack:status", { status: "disconnected" });
    }
  }

  async getAvailableChannels(): Promise<SlackAvailableChannel[]> {
    if (!this.app) return [];

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (this.app as any).client;
      const result = await client.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
      });

      const channels: SlackAvailableChannel[] = [];
      for (const ch of result.channels ?? []) {
        if (ch.id && ch.name) {
          channels.push({ id: ch.id, name: ch.name });
        }
      }
      return channels;
    } catch (err) {
      console.error("[Slack] Failed to list channels:", err);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: Slack → COO
  // -------------------------------------------------------------------------

  private async handleMessage(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any,
  ): Promise<void> {
    // Ignore bot messages and message_changed/deleted subtypes
    if (message.bot_id || message.subtype) return;

    const slackUserId: string = message.user;
    const channelId: string = message.channel;
    const threadTs: string | undefined = message.thread_ts ?? message.ts;

    // Check if this is a DM (im) or channel message
    const isDM = message.channel_type === "im";

    const requireMention = getConfig("slack:require_mention") !== "false";

    // In channels, only respond to @mentions (unless require_mention is off)
    if (!isDM && requireMention) {
      // The message event doesn't include mention data — only app_mention does.
      // So in channels with requireMention, we rely on the app_mention handler.
      return;
    }

    // Channel whitelist: if set, only respond in allowed channels (DMs always allowed)
    if (!isDM) {
      const raw = getConfig("slack:allowed_channels");
      if (raw) {
        try {
          const allowed: string[] = JSON.parse(raw);
          if (allowed.length > 0 && !allowed.includes(channelId)) {
            return;
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const slackUsername = slackUserId; // Will be resolved later if needed

    // Check pairing
    if (!isPaired(slackUserId)) {
      const code = generatePairingCode(slackUserId, slackUsername);
      await say({
        text: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*\`${code}\`*\n\nThis code expires in 1 hour.`,
        thread_ts: threadTs,
      });
      this.io.emit("slack:pairing-request", {
        code,
        slackUserId,
        slackUsername,
      });
      return;
    }

    // Extract content
    let content: string = message.text ?? "";
    if (!content.trim()) return;

    await this.routeToCOO(channelId, threadTs, slackUserId, content, say);
  }

  private async handleAppMention(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any,
  ): Promise<void> {
    const slackUserId: string = event.user;
    const channelId: string = event.channel;
    const threadTs: string | undefined = event.thread_ts ?? event.ts;

    // Channel whitelist
    const raw = getConfig("slack:allowed_channels");
    if (raw) {
      try {
        const allowed: string[] = JSON.parse(raw);
        if (allowed.length > 0 && !allowed.includes(channelId)) {
          return;
        }
      } catch { /* ignore */ }
    }

    const slackUsername = slackUserId;

    if (!isPaired(slackUserId)) {
      const code = generatePairingCode(slackUserId, slackUsername);
      await say({
        text: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*\`${code}\`*\n\nThis code expires in 1 hour.`,
        thread_ts: threadTs,
      });
      this.io.emit("slack:pairing-request", {
        code,
        slackUserId,
        slackUsername,
      });
      return;
    }

    // Strip bot mention from text
    let content: string = event.text ?? "";
    content = content.replace(/<@[A-Z0-9]+>/g, "").trim();
    if (!content) return;

    await this.routeToCOO(channelId, threadTs, slackUserId, content, say);
  }

  private async handleReactionAdded(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any,
  ): Promise<void> {
    // Only track reactions from paired users for now
    const slackUserId: string = event.user;
    if (!isPaired(slackUserId)) return;

    // Log the reaction — can be expanded to trigger specific actions
    console.log(
      `[Slack] Reaction :${event.reaction}: from ${slackUserId} on item ${event.item?.ts ?? "unknown"}`,
    );
  }

  private async handleSlashCommand(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    command: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    say: any,
  ): Promise<void> {
    const slackUserId: string = command.user_id;
    const channelId: string = command.channel_id;
    const text: string = command.text?.trim() ?? "";

    if (!isPaired(slackUserId)) {
      const code = generatePairingCode(slackUserId, command.user_name ?? slackUserId);
      await say({
        text: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*\`${code}\`*\n\nThis code expires in 1 hour.`,
      });
      this.io.emit("slack:pairing-request", {
        code,
        slackUserId,
        slackUsername: command.user_name ?? slackUserId,
      });
      return;
    }

    if (!text) {
      await say("Usage: `/otterbot <message>` — Send a message to Otterbot.");
      return;
    }

    await this.routeToCOO(channelId, undefined, slackUserId, text, say);
  }

  private async routeToCOO(
    channelId: string,
    threadTs: string | undefined,
    slackUserId: string,
    content: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _say: any,
  ): Promise<void> {
    const convKey = `${slackUserId}:${channelId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Slack: ${slackUserId} — ${content.slice(0, 60)}`;
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

    // Track pending response
    this.pendingResponses.set(conversationId, {
      channelId,
      threadTs,
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
        source: "slack",
        slackUserId,
        slackChannelId: channelId,
        slackThreadTs: threadTs,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Slack
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const pending = this.pendingResponses.get(conversationId);
    if (!pending) return;

    this.pendingResponses.delete(conversationId);

    this.sendSlackMessage(pending.channelId, message.content, pending.threadTs).catch(
      (err) => {
        console.error("[Slack] Error sending reply:", err);
      },
    );
  }

  private async sendSlackMessage(
    channelId: string,
    content: string,
    threadTs?: string,
  ): Promise<void> {
    if (!this.app) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (this.app as any).client;
    const chunks = splitMessage(content, SLACK_MAX_LENGTH);

    for (const chunk of chunks) {
      await client.chat.postMessage({
        channel: channelId,
        text: chunk,
        thread_ts: threadTs,
      });
    }
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
