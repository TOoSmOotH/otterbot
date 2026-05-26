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
  /**
   * Resolve a configured channel id to its canonical form (Matrix: a room alias
   * like `#room:hs` → its internal `!id:hs`). Optional — when absent the
   * configured id is used as-is. Called once after start().
   */
  resolveChannelId?(configured: string): Promise<string>;
  /**
   * Post plain text to a channel; returns an opaque handle for a later edit.
   * When `threadId` is set, post into that native thread (starting it if needed).
   */
  sendText(channelId: string, text: string, threadId?: string): Promise<MessageHandle>;
  /** Edit a previously sent message in place. Only valid when canEdit. */
  edit(handle: MessageHandle, text: string): Promise<void>;
  /** Post a structured agent-to-agent message, rendered per provider. */
  sendRich(channelId: string, msg: RichChatMessage): Promise<void>;
  /**
   * Upload a file to a channel. Images render inline; other types attach.
   * When `threadId` is set, upload into that native thread.
   */
  sendFile(channelId: string, file: OutboundFile, threadId?: string): Promise<void>;
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
  /**
   * Provider id of this message (Slack `ts`, Discord message id, Matrix
   * `event_id`). Used as the thread-root key when this is a top-level message.
   */
  messageId: string;
  /**
   * Thread-root id when this message already belongs to a native thread
   * (Slack `thread_ts`, Discord thread channel id, Matrix `m.thread` root).
   * Undefined for a top-level message.
   */
  threadId?: string;
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
