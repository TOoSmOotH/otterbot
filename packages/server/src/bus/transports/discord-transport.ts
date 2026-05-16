import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  type Message,
  type SendableChannels,
} from "discord.js";
import { nanoid } from "nanoid";
import type { AgentMessage, AgentMsgKind } from "@otterbot/shared";
import type { Transport } from "./transport.js";

const KIND_COLOR: Record<AgentMsgKind, number> = {
  request: 0x6b8cff,
  response: 0x4ade80,
  broadcast: 0xa78bfa,
  spawn: 0xfbbf24,
  report: 0x4ade80,
  status: 0x5a5a64,
  tool: 0x5a5a64,
  error: 0xf87171,
};

/**
 * Routes agent-to-agent messages through a shared Discord channel. Each agent's
 * messages post as a colour-coded embed authored by the agent, so the swarm's
 * chatter is readable in Discord. Human messages typed in the channel are
 * routed to the COO as a request, letting a person talk to the swarm.
 *
 * Requires a bot token + channel id and the (privileged) Message Content
 * intent enabled in the Discord developer portal.
 */
export class DiscordTransport implements Transport {
  readonly id = "discord" as const;
  private readonly client: Client;
  private channel: SendableChannels | null = null;
  private receiveHandler: (msg: AgentMessage) => void = () => {};

  constructor(
    private readonly token: string,
    private readonly channelId: string
  ) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
    await new Promise<void>((resolve) => {
      if (this.client.isReady()) resolve();
      else this.client.once(Events.ClientReady, () => resolve());
    });
    const channel = await this.client.channels.fetch(this.channelId);
    if (channel && channel.isTextBased() && channel.isSendable()) {
      this.channel = channel;
    } else {
      console.warn("[discord] channel is not a sendable text channel:", this.channelId);
    }
    this.client.on(Events.MessageCreate, (m) => this.onDiscordMessage(m));
    console.info("[discord] transport connected");
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async send(msg: AgentMessage): Promise<void> {
    if (!this.channel) return;
    const embed = new EmbedBuilder()
      .setColor(KIND_COLOR[msg.kind] ?? 0x5a5a64)
      .setAuthor({ name: msg.from })
      .setDescription(msg.body.slice(0, 4000) || "(no content)")
      .setFooter({ text: `${msg.kind} → ${msg.to ?? "all"} · ${msg.id}` });
    try {
      await this.channel.send({ embeds: [embed] });
    } catch (err) {
      console.warn("[discord] send failed:", err);
    }
  }

  onReceive(handler: (msg: AgentMessage) => void): void {
    this.receiveHandler = handler;
  }

  /** A human message in the channel becomes a request routed to the COO. */
  private onDiscordMessage(m: Message): void {
    if (m.author.bot || m.channelId !== this.channelId || !m.content.trim()) return;
    this.receiveHandler({
      id: nanoid(),
      seq: 0,
      kind: "request",
      from: "discord-user",
      to: "coo",
      threadId: nanoid(),
      correlationId: null,
      rootSpawnId: null,
      body: m.content,
      transport: "discord",
      createdAt: new Date().toISOString(),
    });
  }
}
