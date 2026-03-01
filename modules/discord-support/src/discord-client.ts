import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  type Message as DiscordMessage,
  type ThreadChannel,
} from "discord.js";
import type { ModuleContext } from "@otterbot/shared";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MessageHandler = (
  message: DiscordMessage,
  thread: ThreadChannel,
) => Promise<void>;

export type ResponseMode = "auto" | "mention" | "new_threads";

// ─── Discord Support Client ─────────────────────────────────────────────────

const DISCORD_MAX_LENGTH = 2000;
const TYPING_INTERVAL_MS = 5000;

export class DiscordSupportClient {
  private client: Client | null = null;
  private ctx: ModuleContext;
  private onMessage: MessageHandler;
  /** Set of thread IDs where we've already responded (for new_threads mode) */
  private respondedThreads = new Set<string>();

  constructor(ctx: ModuleContext, onMessage: MessageHandler) {
    this.ctx = ctx;
    this.onMessage = onMessage;
  }

  async start(): Promise<void> {
    const token = this.ctx.getConfig("discord_token");
    if (!token) {
      this.ctx.warn("discord_token not configured — Discord client not started");
      return;
    }

    if (this.client) {
      await this.stop();
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });

    this.client.on(Events.ClientReady, (c) => {
      this.ctx.log(`Discord support bot logged in as ${c.user.tag}`);
    });

    this.client.on(Events.Error, (error) => {
      this.ctx.error("Discord client error:", error);
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((err) => {
        this.ctx.error("Error handling Discord message:", err);
      });
    });

    await this.client.login(token);
  }

  async stop(): Promise<void> {
    this.respondedThreads.clear();
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.ctx.log("Discord support bot disconnected");
    }
  }

  get botUserId(): string | null {
    return this.client?.user?.id ?? null;
  }

  // ─── Message handling ───────────────────────────────────────────────────

  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    // Only handle messages in threads
    if (!message.channel.isThread()) return;

    const thread = message.channel as ThreadChannel;

    // Check if the parent is a monitored forum channel
    const parentId = thread.parentId;
    if (!parentId || !this.isMonitoredChannel(parentId)) return;

    // Check response mode
    if (!this.shouldRespond(message, thread)) return;

    // Delegate to handler
    await this.onMessage(message, thread);
  }

  private isMonitoredChannel(channelId: string): boolean {
    const raw = this.ctx.getConfig("forum_channel_ids");
    if (!raw) return false;

    const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    return ids.includes(channelId);
  }

  private shouldRespond(message: DiscordMessage, thread: ThreadChannel): boolean {
    const mode = (this.ctx.getConfig("response_mode") ?? "auto") as ResponseMode;

    switch (mode) {
      case "mention": {
        // Only respond when @mentioned
        if (!this.client?.user) return false;
        return message.mentions.has(this.client.user);
      }
      case "new_threads": {
        // Only respond to the first message of new threads we haven't responded to
        if (this.respondedThreads.has(thread.id)) return false;
        this.respondedThreads.add(thread.id);
        return true;
      }
      case "auto":
      default:
        return true;
    }
  }

  // ─── Sending ──────────────────────────────────────────────────────────

  async sendTyping(thread: ThreadChannel): Promise<ReturnType<typeof setInterval>> {
    const sendTyping = () => {
      thread.sendTyping().catch(() => { /* ignore */ });
    };
    sendTyping();
    return setInterval(sendTyping, TYPING_INTERVAL_MS);
  }

  async sendReply(
    thread: ThreadChannel,
    content: string,
  ): Promise<void> {
    const chunks = splitMessage(content, DISCORD_MAX_LENGTH);
    for (const chunk of chunks) {
      await thread.send(chunk);
    }
  }
}

// ─── Message splitting ──────────────────────────────────────────────────────

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try paragraph boundary
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

    // Try newline
    if (splitIdx === -1) {
      const newlineIdx = remaining.lastIndexOf("\n", maxLength);
      if (newlineIdx > maxLength * 0.3) {
        splitIdx = newlineIdx;
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
