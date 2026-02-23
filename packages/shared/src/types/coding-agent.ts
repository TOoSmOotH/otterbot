/** Types for the live coding agent view (OpenCode, Claude Code, Codex, etc.) */

export type CodingAgentType = "opencode" | "claude-code" | "codex" | "gemini-cli";

export interface CodingAgentSession {
  id: string;
  /** DB row primary key — used for detail-fetch and delete API calls */
  dbId?: string;
  agentId: string;
  projectId: string | null;
  task: string;
  agentType: CodingAgentType;
  status: "active" | "idle" | "completed" | "error" | "awaiting-input" | "awaiting-permission";
  startedAt: string;
  completedAt?: string;
}

export interface CodingAgentPart {
  id: string;
  messageId: string;
  type: "text" | "reasoning" | "tool-invocation" | "step-start" | "file" | "source-url";
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolState?: "call" | "partial-call" | "result";
  toolResult?: string;
}

export interface CodingAgentMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: CodingAgentPart[];
  createdAt: string;
}

export interface CodingAgentFileDiff {
  path: string;
  additions: number;
  deletions: number;
}

export interface CodingAgentPermission {
  id: string;
  type: string;       // "edit" | "bash" | "webfetch" etc.
  title: string;
  pattern?: string | string[];
  metadata: Record<string, unknown>;
}
