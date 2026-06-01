/** Shared coding-CLI metadata for the web UI (indicator, panel, login terminal). */

export type CodingTool = "claude" | "codex" | "gemini" | "opencode";

export const CODING_TOOLS: CodingTool[] = ["claude", "codex", "gemini", "opencode"];

export const CODING_TOOL_LABELS: Record<CodingTool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};

/** The interactive login command run in a terminal — logs in every agent. */
export const CODING_LOGIN_CMDS: Record<CodingTool, string> = {
  claude: "claude",
  // Device-auth flow (code + URL): the browser/loopback OAuth can't complete in
  // the sandboxed terminal.
  codex: "codex login --device-auth",
  gemini: "gemini",
  opencode: "opencode auth login",
};
