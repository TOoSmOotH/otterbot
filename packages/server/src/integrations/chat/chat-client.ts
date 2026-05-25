/**
 * Provider plumbing shared by both chat roles (per-agent connector and the
 * agent-to-agent bus transport). One client instance is created per role with
 * its own credentials; it listens to all of its channels and reports the
 * channelId on each inbound message so each role can filter to its own
 * channel/room. Self-identity and mention detection live inside the client.
 */
export interface ChatClient {
  /** True if edit() is supported (Slack/Discord true, Matrix false). */
  readonly canEdit: boolean;
  /** Register the inbound-message handler. Called before start(). */
  onMessage(handler: (m: InboundChatMessage) => void): void;
  /** Connect and begin listening; resolves once ready. */
  start(): Promise<void>;
  /** Cleanly disconnect. */
  stop(): Promise<void>;
  /** Post plain text to a channel; returns an opaque handle for a later edit. */
  sendText(channelId: string, text: string): Promise<MessageHandle>;
  /** Edit a previously sent message in place. Only valid when canEdit. */
  edit(handle: MessageHandle, text: string): Promise<void>;
  /** Post a structured agent-to-agent message, rendered per provider. */
  sendRich(channelId: string, msg: RichChatMessage): Promise<void>;
  /** Upload a file to a channel. Images render inline; other types attach. */
  sendFile(channelId: string, file: OutboundFile): Promise<void>;
}

/** A file to upload to a channel/room (image rendered inline, others attached). */
export interface OutboundFile {
  data: Buffer;
  filename: string;
  mimeType: string;
}

/** Opaque, provider-specific handle to a posted message (for edits). */
export type MessageHandle = unknown;

/** A normalized inbound human message from a channel/room. */
export interface InboundChatMessage {
  channelId: string;
  senderId: string;
  /** Message text with a leading bot @mention stripped. */
  text: string;
  /** Sent by this bot (or any bot) — skip to avoid echo loops. */
  fromSelf: boolean;
  /** This bot was @mentioned — drives the connector's mentionOnly gate. */
  mentioned: boolean;
}

/** A structured agent-to-agent message for the transport role. */
export interface RichChatMessage {
  /** AgentMessage.from */
  author: string;
  /** AgentMessage.kind */
  kind: string;
  /** AgentMessage.to ?? "all" */
  to: string;
  /** AgentMessage.body */
  body: string;
  /** AgentMessage.id */
  id: string;
}
