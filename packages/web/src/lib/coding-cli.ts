/** Shared coding-CLI metadata for the web UI (indicator, panel, login terminal). */

export type CodingTool = "claude" | "codex" | "antigravity" | "opencode";

export const CODING_TOOLS: CodingTool[] = ["claude", "codex", "antigravity", "opencode"];

export const CODING_TOOL_LABELS: Record<CodingTool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  antigravity: "Antigravity CLI",
  opencode: "OpenCode",
};

/** The interactive login command run in a terminal — logs in every agent. */
export const CODING_LOGIN_CMDS: Record<CodingTool, string> = {
  claude: "claude",
  // Device-auth flow (code + URL): the browser/loopback OAuth can't complete in
  // the sandboxed terminal.
  codex: "codex login --device-auth",
  // First run prints a Google-OAuth URL to open.
  antigravity: "agy",
  opencode: "opencode auth login",
};
