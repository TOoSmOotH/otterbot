/** Whether a coding run streams a live TUI (interactive) or runs to completion
 *  with captured output (headless, read-only — the CLI takes no stdin). */
export type CodingSessionMode = "headless" | "interactive";

/**
 * A live coding-CLI session an agent is currently running. Surfaced in the
 * Activity view's "Live coding sessions" list and carried on the
 * `coding:started` socket event; the snapshot of all active sessions is served
 * from `GET /api/coding-sessions`.
 */
export interface CodingSessionInfo {
  /** The agent running the session (sessions are keyed by agent). */
  agentId: string;
  /** Which CLI is running — "claude" | "codex" | "gemini" | "opencode". */
  tool: string;
  mode: CodingSessionMode;
  /** ISO timestamp the run started. */
  startedAt: string;
}
