import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  OutboundFile,
  RichChatMessage,
} from "./chat-client.js";

/** The subset of a Slack message / app_mention event we use. */
interface SlackMessageEvent {
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  /** Message timestamp — stable id used to dedup app_mention vs message. */
  ts?: string;
  /** Set when the message is a reply inside a thread; the thread's root ts. */
  thread_ts?: string;
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
 * API (posting). Reads a bot token (xoxb-) and app token (xapp-).
 *
 * Subscribes to BOTH `app_mention` and `message`: a mention-only Slack app
 * delivers `app_mention`, an all-messages app delivers `message`, so handling
 * both makes the client work regardless of the app's Event Subscriptions.
 * `mentionOnly` is applied by the connector via the computed `mentioned` flag.
 * Edits are supported (canEdit = true).
 */
export class SlackChatClient implements ChatClient {
  readonly canEdit = true;
  private socket: SocketModeClient | null = null;
  private readonly web: WebClient;
  private handler: (m: InboundChatMessage) => void = () => {};
  private selfUserId = "";
  /** Recently handled message timestamps — dedup app_mention vs message. */
  private readonly seenTs = new Set<string>();

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
    const listener =
      (isAppMention: boolean) =>
      ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
        void ack();
        this.onSlackMessage(event, isAppMention);
      };
    // A mention reaches us as `app_mention` (mention-only apps) and/or `message`
    // (all-messages apps); subscribe to both and dedup by ts.
    socket.on("app_mention", listener(true));
    socket.on("message", listener(false));
    await socket.start();
    this.socket = socket;
    console.info(`[slack] client connected as ${this.selfUserId || "(unknown)"}`);
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect();
    this.socket = null;
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<MessageHandle> {
    const res = await this.web.chat.postMessage({ channel: channelId, text, thread_ts: threadId });
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

  async sendFile(channelId: string, file: OutboundFile, threadId?: string): Promise<void> {
    // Slack types the upload args as a strict union of destinations, which
    // over-constrains an optional thread_ts; build the object and cast.
    const args = {
      channel_id: channelId,
      file: file.data,
      filename: file.filename,
      ...(threadId ? { thread_ts: threadId } : {}),
    } as Parameters<WebClient["files"]["uploadV2"]>[0];
    await this.web.files.uploadV2(args);
  }

  private onSlackMessage(event: SlackMessageEvent, isAppMention: boolean): void {
    if (event.subtype || event.bot_id) return;
    if (!event.channel || !event.user || !event.text) return;
    // The same mention can arrive as both an app_mention and a message event;
    // process each underlying message only once.
    if (event.ts) {
      if (this.seenTs.has(event.ts)) return;
      this.seenTs.add(event.ts);
      if (this.seenTs.size > 500) {
        this.seenTs.delete(this.seenTs.values().next().value as string);
      }
    }
    const mentioned =
      isAppMention || (this.selfUserId !== "" && event.text.includes(`<@${this.selfUserId}>`));
    this.handler({
      channelId: event.channel,
      senderId: event.user,
      text: stripLeadingMention(event.text),
      fromSelf: event.user === this.selfUserId,
      mentioned,
      messageId: event.ts ?? "",
      threadId: event.thread_ts,
    });
  }
}
