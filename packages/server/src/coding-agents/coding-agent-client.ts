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
  /** True when the agent failed due to an authentication/login issue (non-retryable) */
  authError?: boolean;
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

/**
 * Detect authentication/login errors in terminal output from coding agents.
 * These are non-retryable errors — the agent needs credentials configured.
 */
export function detectAuthError(terminalOutput: string): string | null {
  const lower = terminalOutput.toLowerCase();
  const patterns: Array<{ test: (s: string) => boolean; message: string }> = [
    // Generic API key / auth errors
    { test: (s) => /invalid\s*(api[_\s]?key|token|credentials?)/.test(s), message: "Invalid API key or credentials" },
    { test: (s) => /authentication\s+(failed|error|required)/.test(s), message: "Authentication failed" },
    { test: (s) => /unauthorized|401\s*unauthorized/.test(s), message: "Unauthorized — invalid or missing credentials" },
    { test: (s) => /api[_\s]?key\s*(is\s*)?(not\s+set|missing|required|invalid|expired)/.test(s), message: "API key not configured or invalid" },
    { test: (s) => s.includes("not authenticated") || s.includes("not logged in"), message: "Not authenticated — login required" },
    { test: (s) => /please\s+(log\s*in|sign\s*in|authenticate)/.test(s), message: "Login required" },
    // Claude Code specific
    { test: (s) => s.includes("anthropic_api_key") && (s.includes("not set") || s.includes("invalid") || s.includes("missing")), message: "ANTHROPIC_API_KEY not set or invalid" },
    { test: (s) => s.includes("could not authenticate with anthropic"), message: "Could not authenticate with Anthropic" },
    // OpenAI / Codex specific
    { test: (s) => s.includes("openai_api_key") && (s.includes("not set") || s.includes("invalid") || s.includes("missing")), message: "OPENAI_API_KEY not set or invalid" },
    { test: (s) => /incorrect\s*api\s*key/.test(s), message: "Incorrect API key" },
    // Gemini specific
    { test: (s) => s.includes("gemini_api_key") && (s.includes("not set") || s.includes("invalid") || s.includes("missing")), message: "GEMINI_API_KEY not set or invalid" },
    // Google OAuth
    { test: (s) => /gcloud.*auth|google.*auth/.test(s) && /login|required|expired/.test(s), message: "Google authentication required" },
    // Rate limit / quota (also non-retryable without intervention)
    { test: (s) => /quota\s*(exceeded|exhausted)/.test(s), message: "API quota exceeded" },
    { test: (s) => /billing\s*(not\s+active|required|issue)/.test(s), message: "Billing not active — payment required" },
    { test: (s) => s.includes("insufficient_quota"), message: "Insufficient API quota" },
  ];

  for (const { test, message } of patterns) {
    if (test(lower)) return message;
  }
  return null;
}
