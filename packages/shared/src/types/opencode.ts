/** Types for the OpenCode live coding view */

export interface OpenCodeSession {
  id: string;
  agentId: string;
  projectId: string | null;
  task: string;
  status: "active" | "idle" | "completed" | "error";
  startedAt: string;
  completedAt?: string;
}

export interface OpenCodePart {
  id: string;
  messageId: string;
  type: "text" | "reasoning" | "tool-invocation" | "step-start" | "file" | "source-url";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolState?: "call" | "partial-call" | "result";
  toolResult?: string;
}

export interface OpenCodeMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: OpenCodePart[];
  createdAt: string;
}

export interface OpenCodeFileDiff {
  path: string;
  additions: number;
  deletions: number;
}
