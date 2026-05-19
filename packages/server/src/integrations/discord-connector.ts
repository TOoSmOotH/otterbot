import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { ChannelBotConfig } from "@otterbot/shared";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { ChannelConnector, THINKING_PLACEHOLDER } from "./channel-connector.js";

/**
 * Connects one agent to a Discord channel with its own bot client. Inbound
 * channel messages run an agent turn (gated by `publicBot` / `allowedUserIds`)
 * and the reply is posted back to the channel.
 *
 * Reads `DISCORD_BOT_TOKEN` from the agent's encrypted credentials. This is a
 * separate client from the instance-wide Discord bus transport — they coexist.
 *
 * Requires the (privileged) Message Content intent enabled in the Discord
 * developer portal.
 */
export class DiscordConnector extends ChannelConnector {
  private client: Client | null = null;
  private channel: SendableChannels | null = null;

  constructor(
    agentId: string,
    cfg: ChannelBotConfig,
    private readonly botToken: string,
    getRuntime: () => AgentRuntime | undefined
  ) {
    super("discord", agentId, cfg, getRuntime);
  }

  async start(): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    await client.login(this.botToken);
    await new Promise<void>((resolve) => {
      if (client.isReady()) resolve();
      else client.once(Events.ClientReady, () => resolve());
    });
    const channel = await client.channels.fetch(this.cfg.channelId);
    if (channel && channel.isTextBased() && channel.isSendable()) {
      this.channel = channel;
    } else {
      console.warn(
        `[discord] connector channel is not a sendable text channel: ${this.cfg.channelId}`
      );
    }
    client.on(Events.MessageCreate, (m) => this.onDiscordMessage(m));
    this.client = client;
    console.info(`[discord] connector connected for ${this.agentId}`);
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.channel = null;
  }

  protected async postThinking(): Promise<unknown> {
    if (!this.channel) return null;
    return await this.channel.send(THINKING_PLACEHOLDER);
  }

  protected async post(text: string, replace?: unknown): Promise<void> {
    const body = text.slice(0, 2000) || "(no content)";
    // `replace` is the placeholder Message — edit it in place.
    if (replace) {
      await (replace as Message).edit(body);
      return;
    }
    if (!this.channel) return;
    await this.channel.send(body);
  }

  private onDiscordMessage(m: Message): void {
    if (m.author.bot || m.channelId !== this.cfg.channelId) return;
    const botUser = this.client?.user;
    if (this.cfg.mentionOnly) {
      // Only reply when this bot is @mentioned.
      if (!botUser || !m.mentions.has(botUser)) return;
    }
    const text = botUser
      ? m.content.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "").trim()
      : m.content;
    this.handleInbound(m.author.id, text);
  }
}
