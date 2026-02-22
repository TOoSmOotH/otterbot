import IrcFramework from "irc-framework";
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
// IRC Bridge
// ---------------------------------------------------------------------------

const IRC_MAX_LENGTH = 450; // Safe limit for IRC messages

export interface IrcConfig {
  server: string;
  port: number;
  nickname: string;
  channels: string[];
  tls?: boolean;
  password?: string;
}

export class IrcBridge {
  private client: IrcFramework.Client | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{nick}:{channel}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → channel name (for sending responses) */
  private channelMap = new Map<string, string>();
  private config: IrcConfig | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: IrcConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    this.config = config;

    this.client = new IrcFramework.Client();

    this.client.connect({
      host: config.server,
      port: config.port,
      nick: config.nickname,
      tls: config.tls ?? false,
      password: config.password,
    });

    this.client.on("registered", () => {
      if (!this.client) return;
      console.log(`[IRC] Connected as ${config.nickname} to ${config.server}`);
      for (const channel of config.channels) {
        this.client.join(channel);
      }
      this.io.emit("irc:status", {
        status: "connected",
        nickname: config.nickname,
      });
    });

    this.client.on("join", (event: { channel: string; nick: string }) => {
      if (event.nick === config.nickname) {
        console.log(`[IRC] Joined ${event.channel}`);
      }
    });

    this.client.on("part", (event: { channel: string; nick: string }) => {
      if (event.nick === config.nickname) {
        console.log(`[IRC] Left ${event.channel}`);
      }
    });

    this.client.on("privmsg", (event: { nick: string; target: string; message: string }) => {
      this.handleMessage(event.nick, event.target, event.message).catch((err) => {
        console.error("[IRC] Error handling message:", err);
      });
    });

    this.client.on("close", () => {
      console.log("[IRC] Connection closed");
      this.io.emit("irc:status", { status: "disconnected" });
    });

    this.client.on("socket close", () => {
      console.log("[IRC] Socket closed");
      this.io.emit("irc:status", { status: "disconnected" });
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

    // Disconnect client
    if (this.client) {
      this.client.quit("Shutting down");
      this.client = null;
      this.io.emit("irc:status", { status: "disconnected" });
    }

    this.config = null;
  }

  getJoinedChannels(): string[] {
    return this.config?.channels ?? [];
  }

  // -------------------------------------------------------------------------
  // Inbound: IRC → COO
  // -------------------------------------------------------------------------

  private async handleMessage(
    nick: string,
    target: string,
    content: string,
  ): Promise<void> {
    // Ignore messages from self
    if (nick === this.config?.nickname) return;

    const isDM = target === this.config?.nickname;
    const channel = isDM ? nick : target;

    // In channels, only respond when mentioned
    if (!isDM && this.config?.nickname) {
      if (!content.includes(this.config.nickname)) {
        return;
      }
      // Strip the mention
      content = content
        .replace(new RegExp(`\\b${escapeRegex(this.config.nickname)}[:\\s,]*`, "g"), "")
        .trim();
    }

    if (!content) return;

    await this.routeToCOO(nick, channel, content, isDM);
  }

  private async routeToCOO(
    nick: string,
    channel: string,
    content: string,
    isDM: boolean,
  ): Promise<void> {
    const convKey = `${nick}:${channel}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `IRC: ${nick} in ${channel} — ${content.slice(0, 60)}`;
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
        source: "irc",
        ircNick: nick,
        ircChannel: channel,
        ircIsDM: isDM,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → IRC
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const channel = this.channelMap.get(conversationId);
    if (!channel || !this.client) return;

    this.sendIrcMessage(channel, message.content);
  }

  private sendIrcMessage(target: string, content: string): void {
    if (!this.client) return;

    const lines = splitMessage(content, IRC_MAX_LENGTH);
    for (const line of lines) {
      this.client.say(target, line);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
