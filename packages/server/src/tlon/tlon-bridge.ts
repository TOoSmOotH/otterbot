import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Tlon / Urbit Bridge
// ---------------------------------------------------------------------------

const TLON_MAX_LENGTH = 8000; // Reasonable limit for Tlon messages

export interface TlonConfig {
  shipUrl: string;
  accessCode: string;
  shipName: string;
}

export class TlonBridge {
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{ship}:{channel}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → channel path (for sending responses) */
  private channelMap = new Map<string, string>();
  private config: TlonConfig | null = null;
  private cookie: string | null = null;
  private eventSource: { close(): void } | null = null;
  private lastEventId = 0;
  private connected = false;
  private abortController: AbortController | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: TlonConfig): Promise<void> {
    if (this.connected) {
      await this.stop();
    }

    this.config = config;

    // Authenticate with the ship
    await this.authenticate();

    // Subscribe to chat updates via SSE
    this.subscribeToEvents();

    this.connected = true;
    console.log(`[Tlon] Connected to ${config.shipName} at ${config.shipUrl}`);
    this.io.emit("tlon:status" as any, {
      status: "connected",
      shipName: config.shipName,
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);
  }

  async stop(): Promise<void> {
    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Close SSE connection
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.connected = false;
    this.cookie = null;
    this.config = null;
    this.io.emit("tlon:status" as any, { status: "disconnected" });
  }

  isConnected(): boolean {
    return this.connected;
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    if (!this.config) throw new Error("Tlon bridge not configured");

    const url = `${this.config.shipUrl}/~/login`;
    const res = await fetch(url, {
      method: "PUT",
      body: `password=${encodeURIComponent(this.config.accessCode)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
    });

    // Urbit returns 204 on successful auth with a set-cookie header
    if (res.status !== 204 && res.status !== 200 && res.status !== 302) {
      throw new Error(`Authentication failed: HTTP ${res.status}`);
    }

    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) {
      throw new Error("Authentication failed: no session cookie returned");
    }

    // Extract the urbauth cookie
    const match = setCookie.match(/urbauth[^=]*=([^;]+)/);
    this.cookie = match ? `urbauth-${this.config.shipName}=${match[1]}` : setCookie.split(";")[0];
  }

  // -------------------------------------------------------------------------
  // SSE Subscription
  // -------------------------------------------------------------------------

  private subscribeToEvents(): void {
    if (!this.config || !this.cookie) return;

    this.abortController = new AbortController();

    // Subscribe to the chat channel via Urbit's channel API
    const channelId = `otterbot-${Date.now()}`;
    const channelUrl = `${this.config.shipUrl}/~/channel/${channelId}`;

    // Open subscription by PUT-ing a subscribe action
    this.openSubscription(channelUrl, channelId).catch((err) => {
      console.error("[Tlon] Failed to open subscription:", err);
    });
  }

  private async openSubscription(channelUrl: string, channelId: string): Promise<void> {
    if (!this.cookie || !this.config) return;

    const subscribeAction = [
      {
        id: ++this.lastEventId,
        action: "subscribe",
        ship: this.config.shipName,
        app: "chat",
        path: "/ui",
      },
    ];

    await fetch(channelUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookie,
      },
      body: JSON.stringify(subscribeAction),
      signal: this.abortController?.signal,
    });

    // Start SSE listener on the channel
    this.listenToSSE(channelUrl, channelId);
  }

  private listenToSSE(channelUrl: string, channelId: string): void {
    if (!this.cookie) return;

    // Use fetch-based SSE since we need custom headers for auth
    const startListening = async () => {
      try {
        const res = await fetch(channelUrl, {
          method: "GET",
          headers: { Cookie: this.cookie! },
          signal: this.abortController?.signal,
        });

        if (!res.ok || !res.body) {
          console.error(`[Tlon] SSE connection failed: HTTP ${res.status}`);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (this.connected) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEventId: number | null = null;
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("id:")) {
              currentEventId = parseInt(line.slice(3).trim(), 10);
            } else if (line.startsWith("data:")) {
              currentData += line.slice(5).trim();
            } else if (line === "" && currentData) {
              // End of event
              this.handleSSEEvent(currentData, channelUrl, currentEventId);
              currentData = "";
              currentEventId = null;
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("[Tlon] SSE error:", err);
        }
      }
    };

    startListening();
  }

  private handleSSEEvent(
    data: string,
    channelUrl: string,
    eventId: number | null,
  ): void {
    // ACK the event
    if (eventId !== null && this.cookie) {
      const ackAction = [{ id: ++this.lastEventId, action: "ack", "event-id": eventId }];
      fetch(channelUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: this.cookie,
        },
        body: JSON.stringify(ackAction),
      }).catch(() => {
        // Best-effort ACK
      });
    }

    try {
      const parsed = JSON.parse(data);
      if (parsed?.json?.["chat-action"]) {
        const action = parsed.json["chat-action"];
        if (action?.add?.memo) {
          this.handleIncomingMessage(action).catch((err) => {
            console.error("[Tlon] Error handling incoming message:", err);
          });
        }
      }
    } catch {
      // Not a JSON event we care about
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: Tlon → COO
  // -------------------------------------------------------------------------

  private async handleIncomingMessage(action: any): Promise<void> {
    const memo = action.add?.memo;
    if (!memo) return;

    const author = memo.author;
    const content = this.extractContent(memo.content);
    const channel = action.add?.nest ?? "unknown";

    // Ignore messages from our own ship
    if (author === this.config?.shipName) return;

    if (!content) return;

    await this.routeToCOO(author, channel, content);
  }

  extractContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((inline: any) => {
          if (typeof inline === "string") return inline;
          if (inline?.text) return inline.text;
          if (inline?.mention) return inline.mention;
          return "";
        })
        .join("")
        .trim();
    }
    return "";
  }

  private async routeToCOO(
    author: string,
    channel: string,
    content: string,
  ): Promise<void> {
    const convKey = `${author}:${channel}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Tlon: ${author} in ${channel} — ${content.slice(0, 60)}`;
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

    this.channelMap.set(conversationId, channel);

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "tlon",
        tlonAuthor: author,
        tlonChannel: channel,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Tlon
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const channel = this.channelMap.get(conversationId);
    if (!channel) return;

    this.sendTlonMessage(channel, message.content).catch((err) => {
      console.error("[Tlon] Error sending message:", err);
    });
  }

  async sendTlonMessage(channel: string, content: string): Promise<void> {
    if (!this.config || !this.cookie) return;

    const chunks = splitMessage(content, TLON_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.pokeChat(channel, chunk);
    }
  }

  private async pokeChat(channel: string, content: string): Promise<void> {
    if (!this.config || !this.cookie) return;

    const channelId = `otterbot-${Date.now()}`;
    const channelUrl = `${this.config.shipUrl}/~/channel/${channelId}`;

    const pokeAction = [
      {
        id: ++this.lastEventId,
        action: "poke",
        ship: this.config.shipName,
        app: "chat",
        mark: "chat-action",
        json: {
          "chat-action": {
            add: {
              nest: channel,
              memo: {
                author: this.config.shipName,
                content: [{ text: content }],
                sent: Date.now(),
              },
            },
          },
        },
      },
    ];

    const res = await fetch(channelUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookie,
      },
      body: JSON.stringify(pokeAction),
    });

    if (!res.ok) {
      throw new Error(`Failed to send message: HTTP ${res.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try newline boundary
    const newlineIdx = remaining.lastIndexOf("\n", maxLength);
    if (newlineIdx > maxLength * 0.3) {
      splitIdx = newlineIdx;
    }

    // Try space boundary
    if (splitIdx === -1) {
      const spaceIdx = remaining.lastIndexOf(" ", maxLength);
      if (spaceIdx > maxLength * 0.3) {
        splitIdx = spaceIdx;
      }
    }

    // Hard cut
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
