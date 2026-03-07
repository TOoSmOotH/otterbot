import { AtpAgent, RichText, AppBskyNotificationListNotifications } from "@atproto/api";
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
// Bluesky Bridge
// ---------------------------------------------------------------------------

const BLUESKY_MAX_LENGTH = 300; // Bluesky post limit in graphemes
const POLL_INTERVAL_MS = 30_000; // Poll notifications every 30 seconds

export interface BlueskyBridgeConfig {
  identifier: string;
  appPassword: string;
  service?: string;
}

interface PendingResponse {
  authorDid: string;
  postUri: string;
  postCid: string;
  conversationId: string;
  /** Root of the thread (for proper reply threading) */
  rootUri: string;
  rootCid: string;
}

export class BlueskyBridge {
  private agent: AtpAgent | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{did}` → conversationId */
  private conversationMap = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenAt: string | null = null;
  private myDid: string | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: BlueskyBridgeConfig): Promise<void> {
    if (this.agent) {
      await this.stop();
    }

    const service = config.service ?? "https://bsky.social";
    this.agent = new AtpAgent({ service });

    const response = await this.agent.login({
      identifier: config.identifier,
      password: config.appPassword,
    });

    this.myDid = response.data.did;
    console.log(`[Bluesky] Logged in as @${response.data.handle} (${this.myDid})`);
    this.io.emit("bluesky:status", {
      status: "connected",
      handle: response.data.handle,
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    // Start polling for notifications (mentions/replies)
    this.pollTimer = setInterval(() => {
      this.pollNotifications().catch((err) => {
        console.error("[Bluesky] Error polling notifications:", err);
      });
    }, POLL_INTERVAL_MS);

    // Initial poll
    this.pollNotifications().catch((err) => {
      console.error("[Bluesky] Error on initial notification poll:", err);
    });
  }

  async stop(): Promise<void> {
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
    this.myDid = null;

    if (this.agent) {
      this.agent = null;
      this.io.emit("bluesky:status", { status: "disconnected" });
    }
  }

  // -------------------------------------------------------------------------
  // Public: post to Bluesky
  // -------------------------------------------------------------------------

  async createPost(text: string): Promise<{ uri: string; cid: string } | null> {
    if (!this.agent) return null;

    const rt = new RichText({ text });
    await rt.detectFacets(this.agent);

    const response = await this.agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    });

    return { uri: response.uri, cid: response.cid };
  }

  async getTimeline(limit = 50): Promise<unknown[]> {
    if (!this.agent) return [];

    const response = await this.agent.getTimeline({ limit });
    return response.data.feed;
  }

  // -------------------------------------------------------------------------
  // Inbound: Bluesky notifications → COO
  // -------------------------------------------------------------------------

  private async pollNotifications(): Promise<void> {
    if (!this.agent || !this.myDid) return;

    try {
      const response = await this.agent.listNotifications({ limit: 25 });
      const notifications = response.data.notifications;

      // Process only new, unread notifications
      for (const notif of notifications) {
        // Skip if we've already seen this
        if (this.lastSeenAt && notif.indexedAt <= this.lastSeenAt) continue;

        // We care about mentions and replies
        if (notif.reason === "mention" || notif.reason === "reply") {
          await this.handleNotification(notif);
        }
      }

      // Update the seen cursor
      if (notifications.length > 0) {
        this.lastSeenAt = notifications[0]!.indexedAt;
      }

      // Mark notifications as read
      await this.agent.updateSeenNotifications();
    } catch (err) {
      // If session expired, try to refresh
      if (err instanceof Error && err.message.includes("expired")) {
        console.warn("[Bluesky] Session may have expired, attempting refresh...");
        try {
          await this.agent.resumeSession(this.agent.session!);
        } catch {
          console.error("[Bluesky] Failed to refresh session");
          this.io.emit("bluesky:status", { status: "error" });
        }
      } else {
        throw err;
      }
    }
  }

  private async handleNotification(
    notif: AppBskyNotificationListNotifications.Notification,
  ): Promise<void> {
    const authorDid = notif.author.did;
    const authorHandle = notif.author.handle;

    // Don't respond to our own posts
    if (authorDid === this.myDid) return;

    // Check pairing
    if (!isPaired(authorDid)) {
      const code = generatePairingCode(authorDid, authorHandle);

      // Reply with pairing instructions
      await this.replyToPost(
        notif.uri,
        notif.cid,
        notif.uri,
        notif.cid,
        `I don't recognize you yet. Ask my owner to approve code ${code} in the Otterbot dashboard. Expires in 1 hour.`,
      );

      this.io.emit("bluesky:pairing-request", {
        code,
        blueskyDid: authorDid,
        blueskyHandle: authorHandle,
      });
      return;
    }

    // Extract text from the post record
    const record = notif.record as { text?: string } | undefined;
    const text = record?.text;
    if (!text) return;

    // Strip the bot's mention from the text
    const cleanText = text.replace(new RegExp(`@${this.getHandle()}\\b`, "gi"), "").trim();
    if (!cleanText) return;

    // Determine thread root
    const replyRef = (notif.record as { reply?: { root: { uri: string; cid: string } } })?.reply;
    const rootUri = replyRef?.root?.uri ?? notif.uri;
    const rootCid = replyRef?.root?.cid ?? notif.cid;

    await this.routeToCOO(authorDid, authorHandle, notif.uri, notif.cid, rootUri, rootCid, cleanText);
  }

  private getHandle(): string {
    return this.agent?.session?.handle ?? "";
  }

  private async routeToCOO(
    authorDid: string,
    authorHandle: string,
    postUri: string,
    postCid: string,
    rootUri: string,
    rootCid: string,
    content: string,
  ): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(authorDid);

    if (!conversationId) {
      // Create a new conversation for this Bluesky user
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Bluesky: @${authorHandle} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(authorDid, conversationId);
    } else {
      // Update timestamp
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Track pending response
    this.pendingResponses.set(conversationId, {
      authorDid,
      postUri,
      postCid,
      conversationId,
      rootUri,
      rootCid,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // External user
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "bluesky",
        blueskyDid: authorDid,
        blueskyHandle: authorHandle,
        postUri,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Bluesky
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const pending = this.pendingResponses.get(conversationId);
    if (!pending) return;

    this.pendingResponses.delete(conversationId);

    this.replyToPost(
      pending.postUri,
      pending.postCid,
      pending.rootUri,
      pending.rootCid,
      message.content,
    ).catch((err) => {
      console.error("[Bluesky] Error sending reply:", err);
    });
  }

  private async replyToPost(
    parentUri: string,
    parentCid: string,
    rootUri: string,
    rootCid: string,
    content: string,
  ): Promise<void> {
    if (!this.agent) return;

    const chunks = splitMessage(content, BLUESKY_MAX_LENGTH);

    // Post each chunk as a reply in the thread
    let currentParentUri = parentUri;
    let currentParentCid = parentCid;

    for (const chunk of chunks) {
      const rt = new RichText({ text: chunk });
      await rt.detectFacets(this.agent);

      const response = await this.agent.post({
        text: rt.text,
        facets: rt.facets,
        reply: {
          root: { uri: rootUri, cid: rootCid },
          parent: { uri: currentParentUri, cid: currentParentCid },
        },
        createdAt: new Date().toISOString(),
      });

      // Thread subsequent chunks off the previous reply
      currentParentUri = response.uri;
      currentParentCid = response.cid;
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
