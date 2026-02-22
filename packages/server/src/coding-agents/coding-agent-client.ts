/**
 * Interface for coding agent clients (OpenCode, Claude Code, Codex).
 *
 * Each implementation adapts a specific CLI tool to this common interface,
 * allowing the worker to dispatch tasks to any coding agent uniformly.
 */

export interface CodingAgentTaskResult {
  success: boolean;
  sessionId: string;
  summary: string;
  diff: CodingAgentDiff | null;
  usage: CodingAgentTokenUsage | null;
  error?: string;
}

export interface CodingAgentDiff {
  files: Array<{
    path: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export interface CodingAgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  model: string;
  provider: string;
}

export type GetHumanResponse = (sessionId: string, assistantText: string) => Promise<string | null>;

export type OnPermissionRequest = (
  sessionId: string,
  permission: {
    id: string;
    type: string;
    title: string;
    pattern?: string | string[];
    metadata: Record<string, unknown>;
  },
) => Promise<"once" | "always" | "reject">;

export type OnEvent = (event: { type: string; properties: Record<string, unknown> }) => void;

export interface CodingAgentClient {
  executeTask(
    task: string,
    getHumanResponse?: GetHumanResponse,
    onPermissionRequest?: OnPermissionRequest,
  ): Promise<CodingAgentTaskResult>;
}

/** Sentinel string that signals task completion when detected in streaming output. */
export const TASK_COMPLETE_SENTINEL = "◊◊TASK_COMPLETE_9f8e7d◊◊";
