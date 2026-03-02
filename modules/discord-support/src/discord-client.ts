import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  type Message as DiscordMessage,
  type ThreadChannel,
  type TextChannel,
} from "discord.js";
import type { ModuleContext } from "@otterbot/shared";
import {
  type ChannelConfig,
  type ResponseMode,
  parseChannelConfigs,
  getChannelConfig,
} from "./channel-config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type MessageHandler = (
  message: DiscordMessage,
  channel: ThreadChannel | TextChannel,
) => Promise<void>;

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

  // ─── Channel config helpers ─────────────────────────────────────────────

  private getChannelConfigs(): ChannelConfig[] {
    return parseChannelConfigs(this.ctx.getConfig("channels_config"));
  }

  // ─── Message handling ───────────────────────────────────────────────────

  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    const configs = this.getChannelConfigs();

    // Handle messages in threads (forum posts, thread replies)
    if (message.channel.isThread()) {
      const thread = message.channel as ThreadChannel;
      const parentId = thread.parentId;
      if (!parentId) return;

      // Check if the parent channel is monitored
      const config = getChannelConfig(configs, parentId);
      if (!config || !config.enabled) return;

      if (!this.shouldRespond(message, config.responseMode, thread)) return;

      await this.onMessage(message, thread);
      return;
    }

    // Handle messages in regular text channels
    if (message.channel.type === ChannelType.GuildText) {
      const textChannel = message.channel as TextChannel;
      const config = getChannelConfig(configs, textChannel.id);
      if (!config || !config.enabled) return;

      if (!this.shouldRespond(message, config.responseMode)) return;

      await this.onMessage(message, textChannel);
      return;
    }
  }

  isMonitoredChannel(channelId: string): boolean {
    const configs = this.getChannelConfigs();
    const config = getChannelConfig(configs, channelId);
    return config != null && config.enabled;
  }

  private shouldRespond(
    message: DiscordMessage,
    mode: ResponseMode,
    thread?: ThreadChannel,
  ): boolean {
    switch (mode) {
      case "mention": {
        if (!this.client?.user) return false;
        return message.mentions.has(this.client.user);
      }
      case "new_threads": {
        if (!thread) return false;
        if (this.respondedThreads.has(thread.id)) return false;
        this.respondedThreads.add(thread.id);
        return true;
      }
      case "announce":
      case "readonly":
        // These modes don't respond to user messages
        return false;
      case "auto":
      default:
        return true;
    }
  }

  // ─── Guild channels (for channel picker UI) ────────────────────────────

  async getGuildChannels(): Promise<Array<{ id: string; name: string; type: string }>> {
    if (!this.client) return [];

    const results: Array<{ id: string; name: string; type: string }> = [];

    for (const guild of this.client.guilds.cache.values()) {
      const channels = await guild.channels.fetch();
      for (const channel of channels.values()) {
        if (!channel) continue;
        let type: string;
        switch (channel.type) {
          case ChannelType.GuildForum:
            type = "forum";
            break;
          case ChannelType.GuildText:
            type = "text";
            break;
          case ChannelType.GuildAnnouncement:
            type = "announcement";
            break;
          case ChannelType.GuildVoice:
            type = "voice";
            break;
          default:
            continue; // Skip unsupported channel types
        }
        results.push({ id: channel.id, name: channel.name, type });
      }
    }

    return results;
  }

  // ─── Sending ──────────────────────────────────────────────────────────

  async sendTyping(channel: ThreadChannel | TextChannel): Promise<ReturnType<typeof setInterval>> {
    const sendTyping = () => {
      channel.sendTyping().catch(() => { /* ignore */ });
    };
    sendTyping();
    return setInterval(sendTyping, TYPING_INTERVAL_MS);
  }

  async sendReply(
    channel: ThreadChannel | TextChannel,
    content: string,
  ): Promise<void> {
    const chunks = splitMessage(content, DISCORD_MAX_LENGTH);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  async sendToChannel(channelId: string, content: string): Promise<void> {
    if (!this.client) return;

    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) {
      this.ctx.warn(`Cannot send to channel ${channelId}: not a sendable channel`);
      return;
    }

    const chunks = splitMessage(content, DISCORD_MAX_LENGTH);
    for (const chunk of chunks) {
      await (channel as TextChannel).send(chunk);
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
