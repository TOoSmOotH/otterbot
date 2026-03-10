import { createRestAPIClient, createStreamingAPIClient } from "masto";
import type { mastodon } from "masto";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { isPaired, generatePairingCode } from "./pairing.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Mastodon Bridge
// ---------------------------------------------------------------------------

const MASTODON_MAX_LENGTH = 500; // Mastodon default post limit
const POLL_INTERVAL_MS = 30_000; // Poll notifications every 30 seconds

export interface MastodonBridgeConfig {
  instanceUrl: string;
  accessToken: string;
}

interface PendingResponse {
  authorId: string;
  statusId: string;
  conversationId: string;
  visibility: mastodon.v1.StatusVisibility;
}

export class MastodonBridge {
  private client: mastodon.rest.Client | null = null;
  private streaming: mastodon.streaming.Client | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of mastodon account id → conversationId */
  private conversationMap = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastNotificationId: string | null = null;
  private myAccountId: string | null = null;
  private myAcct: string | null = null;
  private instanceUrl: string | null = null;
  private subscription: { unsubscribe: () => void } | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: MastodonBridgeConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    this.instanceUrl = config.instanceUrl;

    this.client = createRestAPIClient({
      url: config.instanceUrl,
      accessToken: config.accessToken,
    });

    // Verify credentials and get our account info
    const account = await this.client.v1.accounts.verifyCredentials();
    this.myAccountId = account.id;
    this.myAcct = account.acct;
    console.log(`[Mastodon] Logged in as @${account.acct} (${account.id}) on ${config.instanceUrl}`);
    this.io.emit("mastodon:status", {
      status: "connected",
      acct: account.acct,
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    // Try to set up streaming for real-time notifications
    try {
      this.streaming = createStreamingAPIClient({
        streamingApiUrl: `${config.instanceUrl}/api/v1/streaming`,
        accessToken: config.accessToken,
        implementation: typeof WebSocket !== "undefined" ? WebSocket : (await import("ws")).default as unknown as typeof WebSocket,
      });

      const events = this.streaming.user.subscribe();
      const iter = events[Symbol.asyncIterator]();
      let stopped = false;

      const processEvents = async () => {
        try {
          while (!stopped) {
            const result = await iter.next();
            if (result.done) break;
            const event = result.value;
            if (event.event === "notification") {
              const notification = event.payload as mastodon.v1.Notification;
              if (notification.type === "mention") {
                await this.handleMention(notification);
              }
            }
          }
        } catch (err) {
          if (!stopped) {
            console.warn("[Mastodon] Streaming connection lost, falling back to polling:", err);
          }
        }
      };

      this.subscription = {
        unsubscribe: () => {
          stopped = true;
          iter.return?.();
        },
      };

      processEvents();
      console.log("[Mastodon] Streaming connection established");
    } catch (err) {
      console.warn("[Mastodon] Streaming not available, using polling fallback:", err);
      this.streaming = null;
    }

    // Always set up polling as a fallback/supplement
    this.pollTimer = setInterval(() => {
      this.pollNotifications().catch((err) => {
        console.error("[Mastodon] Error polling notifications:", err);
      });
    }, POLL_INTERVAL_MS);

    // Initial poll
    this.pollNotifications().catch((err) => {
      console.error("[Mastodon] Error on initial notification poll:", err);
    });
  }

  async stop(): Promise<void> {
    // Stop streaming
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.streaming = null;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    this.pendingResponses.clear();
    this.myAccountId = null;
    this.myAcct = null;

    if (this.client) {
      this.client = null;
      this.io.emit("mastodon:status", { status: "disconnected" });
    }
  }

  // -------------------------------------------------------------------------
  // Public: post to Mastodon
  // -------------------------------------------------------------------------

  async createPost(text: string, visibility: mastodon.v1.StatusVisibility = "public"): Promise<{ id: string; url: string | null } | null> {
    if (!this.client) return null;

    const status = await this.client.v1.statuses.create({
      status: text,
      visibility,
    });

    return { id: status.id, url: status.url ?? null };
  }

  async getTimeline(limit = 20): Promise<mastodon.v1.Status[]> {
    if (!this.client) return [];

    const statuses = await this.client.v1.timelines.home.list({ limit });
    return statuses;
  }

  // -------------------------------------------------------------------------
  // Inbound: Mastodon notifications → COO
  // -------------------------------------------------------------------------

  private async pollNotifications(): Promise<void> {
    if (!this.client || !this.myAccountId) return;

    try {
      const params: { limit: number; sinceId?: string; types?: readonly mastodon.v1.NotificationType[] } = {
        limit: 30,
        types: ["mention"] as const,
      };
      if (this.lastNotificationId) {
        params.sinceId = this.lastNotificationId;
      }

      const notifications = await this.client.v1.notifications.list(params);

      // Process from oldest to newest
      const sorted = [...notifications].reverse();

      for (const notif of sorted) {
        if (notif.type === "mention") {
          await this.handleMention(notif);
        }
        // Track the latest notification ID
        if (!this.lastNotificationId || notif.id > this.lastNotificationId) {
          this.lastNotificationId = notif.id;
        }
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes("401") || err.message.includes("403"))) {
        console.error("[Mastodon] Authentication error, token may be invalid");
        this.io.emit("mastodon:status", { status: "error" });
      } else {
        throw err;
      }
    }
  }

  private async handleMention(notif: mastodon.v1.Notification): Promise<void> {
    if (!notif.status || !notif.account) return;

    const authorId = notif.account.id;
    const authorAcct = notif.account.acct;

    // Don't respond to our own posts
    if (authorId === this.myAccountId) return;

    // Check pairing
    if (!isPaired(authorId)) {
      const code = generatePairingCode(authorId, authorAcct);

      // Reply with pairing instructions
      await this.replyToStatus(
        notif.status.id,
        notif.status.visibility,
        `@${authorAcct} I don't recognize you yet. Ask my owner to approve code ${code} in the Otterbot dashboard. Expires in 1 hour.`,
      );

      this.io.emit("mastodon:pairing-request", {
        code,
        mastodonId: authorId,
        mastodonAcct: authorAcct,
      });
      return;
    }

    // Extract plain text from HTML content
    const text = this.stripHtml(notif.status.content);
    if (!text) return;

    // Strip the bot's mention from the text
    const cleanText = text
      .replace(new RegExp(`@${this.myAcct}\\b`, "gi"), "")
      .trim();
    if (!cleanText) return;

    await this.routeToCOO(authorId, authorAcct, notif.status.id, notif.status.visibility, cleanText);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p><p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  private async routeToCOO(
    authorId: string,
    authorAcct: string,
    statusId: string,
    visibility: mastodon.v1.StatusVisibility,
    content: string,
  ): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(authorId);

    if (!conversationId) {
      // Create a new conversation for this Mastodon user
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Mastodon: @${authorAcct} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(authorId, conversationId);
    } else {
      // Update timestamp
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Track pending response
    this.pendingResponses.set(conversationId, {
      authorId,
      statusId,
      conversationId,
      visibility,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // External user
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "mastodon",
        mastodonId: authorId,
        mastodonAcct: authorAcct,
        statusId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Mastodon
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const pending = this.pendingResponses.get(conversationId);
    if (!pending) return;

    this.pendingResponses.delete(conversationId);

    this.replyToStatus(
      pending.statusId,
      pending.visibility,
      message.content,
    ).catch((err) => {
      console.error("[Mastodon] Error sending reply:", err);
    });
  }

  private async replyToStatus(
    inReplyToId: string,
    visibility: mastodon.v1.StatusVisibility,
    content: string,
  ): Promise<void> {
    if (!this.client) return;

    const chunks = splitMessage(content, MASTODON_MAX_LENGTH);

    let currentReplyId = inReplyToId;

    for (const chunk of chunks) {
      const status = await this.client.v1.statuses.create({
        status: chunk,
        inReplyToId: currentReplyId,
        visibility,
      });

      // Thread subsequent chunks off the previous reply
      currentReplyId = status.id;
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

    // Final fallback: hard cut at space
    if (splitIdx === -1) {
      const spaceIdx = remaining.lastIndexOf(" ", maxLength);
      if (spaceIdx > maxLength * 0.3) {
        splitIdx = spaceIdx;
      }
    }

    // Absolute fallback
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
