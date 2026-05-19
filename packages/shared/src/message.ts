export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messageCount?: number;
  lastCompactedAt?: string | null;
}

/** A conversation as listed in the web UI's chat-history browser. */
export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messageCount: number;
}

/**
 * The running compacted summary of a conversation — the oldest turns folded
 * into a recap so the live context stays within budget. Distinct from a
 * `SessionSummary`, which is the end-of-session learning artifact.
 */
export interface ConversationRecap {
  recap: string;
  keyPoints: string[];
  coveredMessageCount: number;
  updatedAt: string;
}

/** Token-budget accounting for a conversation's live context window. */
export interface ContextStatus {
  budgetTokens: number;
  usedTokens: number;
  recapTokens: number;
  verbatimTokens: number;
  messageCount: number;
  compactedMessageCount: number;
  overBudget: boolean;
  lastCompactedAt: string | null;
}

export type StreamChunk =
  | { kind: "token"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_start"; id: string; name: string; args: unknown }
  | { kind: "tool_end"; id: string; result: unknown }
  | { kind: "error"; message: string };
