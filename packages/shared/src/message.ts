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

/**
 * A file produced by an agent (an image, document, …) that can be retrieved and
 * displayed elsewhere. Its `url` is globally addressable and token-authed, so an
 * artifact produced by one agent renders fine when referenced by another (e.g.
 * the COO displaying a file a delegated agent created).
 */
export interface Artifact {
  /** The stored, traversal-safe basename — also the URL's last segment. */
  id: string;
  kind: "image" | "file";
  /** e.g. `/api/agents/<agentId>/files/<id>`. */
  url: string;
  /** Display name / original filename. */
  name: string;
  mimeType: string;
  /** Present for generated images. */
  prompt?: string;
}

export type StreamChunk =
  | { kind: "token"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_start"; id: string; name: string; args: unknown }
  | { kind: "tool_end"; id: string; result: unknown }
  | { kind: "artifacts"; artifacts: Artifact[] }
  | { kind: "error"; message: string };
