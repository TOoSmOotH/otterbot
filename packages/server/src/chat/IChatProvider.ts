/**
 * Common interface for messaging-platform chat providers (Discord, Teams, Slack, etc.).
 */
export interface IChatProvider {
  /** Unique identifier for this provider type (e.g. "discord", "teams"). */
  readonly id: string;

  /** Human-readable display name. */
  readonly name: string;

  /** Connect to the messaging platform and begin listening for messages. */
  start(): Promise<void>;

  /** Gracefully disconnect from the messaging platform. */
  stop(): Promise<void>;

  /** Send a text message to the given channel/conversation. */
  sendMessage(channelId: string, content: string): Promise<void>;
}
