import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  OutboundFile,
  RichChatMessage,
} from "../integrations/chat/chat-client.js";

/** An in-memory ChatClient for network-free tests of the generic wrappers. */
export class FakeChatClient implements ChatClient {
  readonly canEdit: boolean;
  started = false;
  stopped = false;
  sent: { channelId: string; text: string; threadId?: string }[] = [];
  edits: { handle: MessageHandle; text: string }[] = [];
  rich: { channelId: string; msg: RichChatMessage }[] = [];
  files: { channelId: string; file: OutboundFile; threadId?: string }[] = [];
  private handler: (m: InboundChatMessage) => void = () => {};
  private seq = 0;

  constructor(canEdit = true) {
    this.canEdit = canEdit;
  }

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  async sendText(channelId: string, text: string, threadId?: string): Promise<MessageHandle> {
    this.sent.push({ channelId, text, threadId });
    return `handle-${this.seq++}`;
  }
  async edit(handle: MessageHandle, text: string): Promise<void> {
    this.edits.push({ handle, text });
  }
  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    this.rich.push({ channelId, msg });
  }
  async sendFile(channelId: string, file: OutboundFile, threadId?: string): Promise<void> {
    this.files.push({ channelId, file, threadId });
  }

  /** Test helper: simulate an inbound message (defaults are a plain top-level msg). */
  emit(m: Partial<InboundChatMessage> = {}): void {
    this.handler({
      channelId: "C1",
      senderId: "U1",
      text: "hello",
      fromSelf: false,
      mentioned: false,
      messageId: "M1",
      ...m,
    });
  }
}
