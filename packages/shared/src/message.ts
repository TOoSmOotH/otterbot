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
}

export type StreamChunk =
  | { kind: "token"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_start"; id: string; name: string; args: unknown }
  | { kind: "tool_end"; id: string; result: unknown }
  | { kind: "error"; message: string };
