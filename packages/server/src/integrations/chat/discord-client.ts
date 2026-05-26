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
  /**
   * Recently seen inbound messages, keyed by id. A top-level message's id is
   * also its future thread id (Discord gives a message-rooted thread the same
   * snowflake), so we keep the Message around to start that thread on the first
   * reply. Bounded to avoid unbounded growth.
   */
  private readonly messages = new Map<string, Message>();

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
    this.messages.clear();
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

  /**
   * Resolve where to post. With no `threadId`, the channel itself. Otherwise the
   * thread `threadId` names: a known thread channel (an in-thread reply), or —
   * when `threadId` is a top-level message id with no thread yet — a thread
   * started off that message (its id then equals the message id). Falls back to
   * the parent channel so the human still gets a reply.
   */
  private async target(channelId: string, threadId?: string): Promise<SendableChannels | null> {
    if (!threadId) return this.channel(channelId);
    const known = this.channels.get(threadId);
    if (known) return known;
    const msg = this.messages.get(threadId);
    if (msg) {
      try {
        const name = msg.content.slice(0, 80).trim() || "Otterbot thread";
        const thread = await msg.startThread({ name });
        if (thread.isSendable()) {
          this.channels.set(thread.id, thread);
          return thread;
        }
      } catch (err) {
        console.warn(
          `[discord] could not start a thread for ${threadId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
    return this.channel(channelId);
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<MessageHandle> {
    const ch = await this.target(channelId, threadId);
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

  async sendFile(channelId: string, file: OutboundFile, threadId?: string): Promise<void> {
    const ch = await this.target(channelId, threadId);
    if (!ch) return;
    await ch.send({ files: [new AttachmentBuilder(file.data, { name: file.filename })] });
  }

  private onDiscordMessage(m: Message): void {
    const self = this.client?.user;
    if (!self) return;
    const mentioned = m.mentions.has(self);
    const text = m.content.replace(new RegExp(`<@!?${self.id}>`, "g"), "").trim();
    // Remember the message so a top-level one can root a thread on the first
    // reply; keep the map bounded.
    this.messages.set(m.id, m);
    if (this.messages.size > 500) {
      this.messages.delete(this.messages.keys().next().value as string);
    }
    // A message inside a thread reports the thread's own id as channelId; the
    // connector matches on the configured (parent) channel, so normalize to the
    // parent and carry the thread id separately. The thread is sendable, so
    // cache it for replies without an extra fetch.
    const ch = m.channel;
    let channelId = m.channelId;
    let threadId: string | undefined;
    if (ch.isThread()) {
      channelId = ch.parentId ?? m.channelId;
      threadId = ch.id;
      if (ch.isSendable()) this.channels.set(ch.id, ch);
    }
    this.handler({
      channelId,
      senderId: m.author.id,
      text,
      fromSelf: m.author.bot,
      mentioned,
      messageId: m.id,
      threadId,
    });
  }
}
