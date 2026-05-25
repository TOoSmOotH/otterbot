import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  RichChatMessage,
} from "./chat-client.js";

/** The subset of a Slack message event we use. */
interface SlackMessageEvent {
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  bot_id?: string;
}

/** A Slack message handle is the channel + ts needed to edit it. */
interface SlackHandle {
  channel: string;
  ts: string;
}

/** Strip a leading bot @mention (`<@U…> `) so the agent gets a clean prompt. */
function stripLeadingMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, "");
}

/**
 * Slack client plumbing for both chat roles, over Socket Mode (events) + Web
 * API (posting). Reads a bot token (xoxb-) and app token (xapp-). Always
 * subscribes to `message`; mentionOnly is applied by the connector via the
 * computed `mentioned` flag. Edits are supported (canEdit = true).
 */
export class SlackChatClient implements ChatClient {
  readonly canEdit = true;
  private socket: SocketModeClient | null = null;
  private readonly web: WebClient;
  private handler: (m: InboundChatMessage) => void = () => {};
  private selfUserId = "";

  constructor(
    botToken: string,
    private readonly appToken: string
  ) {
    this.web = new WebClient(botToken);
  }

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const auth = (await this.web.auth.test()) as { user_id?: string };
    this.selfUserId = auth.user_id ?? "";
    const socket = new SocketModeClient({ appToken: this.appToken });
    socket.on(
      "message",
      ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
        void ack();
        this.onSlackMessage(event);
      }
    );
    await socket.start();
    this.socket = socket;
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect();
    this.socket = null;
  }

  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    const res = await this.web.chat.postMessage({ channel: channelId, text });
    return res.ts ? ({ channel: channelId, ts: res.ts } satisfies SlackHandle) : null;
  }

  async edit(handle: MessageHandle, text: string): Promise<void> {
    const h = handle as SlackHandle | null;
    if (!h) return;
    await this.web.chat.update({ channel: h.channel, ts: h.ts, text });
  }

  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    const header = `${msg.author} · ${msg.kind} → ${msg.to}`;
    const body = msg.body || "(no content)";
    await this.web.chat.postMessage({ channel: channelId, text: `*${header}*\n${body}` });
  }

  private onSlackMessage(event: SlackMessageEvent): void {
    if (event.subtype || event.bot_id) return;
    if (!event.channel || !event.user || !event.text) return;
    const mentioned = this.selfUserId !== "" && event.text.includes(`<@${this.selfUserId}>`);
    this.handler({
      channelId: event.channel,
      senderId: event.user,
      text: stripLeadingMention(event.text),
      fromSelf: event.user === this.selfUserId,
      mentioned,
    });
  }
}
