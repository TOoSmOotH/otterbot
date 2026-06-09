/**
 * How a coding run is surfaced. Both stream a live PTY the user can watch and
 * type into:
 *  - "interactive" → the agent explicitly opened a session for the user to
 *    drive; the UI auto-pops a terminal.
 *  - "autonomous"  → a run-to-completion task; it streams to the Activity view's
 *    live-sessions list (no auto-popup) and exits on its own when done.
 */
export type CodingSessionMode = "interactive" | "autonomous";

/**
 * A live coding-CLI session an agent is currently running. Surfaced in the
 * Activity view's "Live coding sessions" list and carried on the
 * `coding:started` socket event; the snapshot of all active sessions is served
 * from `GET /api/coding-sessions`.
 */
export interface CodingSessionInfo {
  /** The agent running the session (sessions are keyed by agent). */
  agentId: string;
  /** Which CLI is running — "claude" | "codex" | "antigravity" | "opencode". */
  tool: string;
  mode: CodingSessionMode;
  /** ISO timestamp the run started. */
  startedAt: string;
}
