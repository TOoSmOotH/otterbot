import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { AgentMsgKind } from "@otterbot/shared";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  OutboundFile,
  RichChatMessage,
} from "./chat-client.js";

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
 * Discord client plumbing for both chat roles. Reads a bot token; requires the
 * (privileged) Message Content intent. Edits are supported (canEdit = true).
 */
export class DiscordChatClient implements ChatClient {
  readonly canEdit = true;
  private client: Client | null = null;
  private handler: (m: InboundChatMessage) => void = () => {};
  private readonly channels = new Map<string, SendableChannels>();

  constructor(private readonly botToken: string) {}

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
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
    client.on(Events.MessageCreate, (m) => this.onDiscordMessage(m));
    this.client = client;
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.channels.clear();
  }

  private async channel(id: string): Promise<SendableChannels | null> {
    const cached = this.channels.get(id);
    if (cached) return cached;
    const ch = await this.client?.channels.fetch(id);
    if (ch && ch.isTextBased() && ch.isSendable()) {
      this.channels.set(id, ch);
      return ch;
    }
    console.warn(`[discord] channel is not a sendable text channel: ${id}`);
    return null;
  }

  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    const ch = await this.channel(channelId);
    if (!ch) return null;
    return await ch.send(text.slice(0, 2000) || "(no content)");
  }

  async edit(handle: MessageHandle, text: string): Promise<void> {
    if (handle) await (handle as Message).edit(text.slice(0, 2000) || "(no content)");
  }

  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    const ch = await this.channel(channelId);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(KIND_COLOR[msg.kind as AgentMsgKind] ?? 0x5a5a64)
      .setAuthor({ name: msg.author })
      .setDescription(msg.body.slice(0, 4000) || "(no content)")
      .setFooter({ text: `${msg.kind} → ${msg.to} · ${msg.id}` });
    await ch.send({ embeds: [embed] });
  }

  async sendFile(channelId: string, file: OutboundFile): Promise<void> {
    const ch = await this.channel(channelId);
    if (!ch) return;
    await ch.send({ files: [new AttachmentBuilder(file.data, { name: file.filename })] });
  }

  private onDiscordMessage(m: Message): void {
    const self = this.client?.user;
    if (!self) return;
    const mentioned = m.mentions.has(self);
    const text = m.content.replace(new RegExp(`<@!?${self.id}>`, "g"), "").trim();
    this.handler({
      channelId: m.channelId,
      senderId: m.author.id,
      text,
      fromSelf: m.author.bot,
      mentioned,
    });
  }
}
