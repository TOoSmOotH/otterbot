import { runAgentShell } from "./shell.js";
import { CODING_TOOLS, withCodingLock, type CodingTool } from "./coding-cli.js";

/**
 * Install + detect the coding CLIs (Claude Code, Codex, Gemini CLI, OpenCode)
 * inside an agent's own sandbox. Everything runs through `runAgentShell`, the
 * same confined shell `shell_exec` uses, so installs land in the agent's
 * workspace npm prefix (`$HOME/.npm-global`, already first on PATH — see
 * `shell.ts`) and persist per agent alongside that tool's per-agent login.
 *
 * We deliberately install per-agent rather than host-global: the sandbox makes
 * `npm i -g` land in the workspace with zero extra plumbing, and each tool's
 * credentials already live under the agent's `/workspace` HOME, so the binary
 * and its login stay co-located and isolated.
 */

export interface CodingCliSpec {
  /** Human-readable name for the UI. */
  label: string;
  /** Binary name resolved on PATH inside the sandbox. */
  bin: string;
  /**
   * Command that installs the tool into the workspace npm prefix. Pinned to
   * `@latest` so a (re)install always pulls the newest release — the tools
   * auto-update themselves thereafter.
   */
  installCmd: string;
  /** The (interactive) login the user runs once from the agent's terminal. */
  loginCmd: string;
  /**
   * `sh` test that is true when this tool has a logged-in credential under the
   * agent's HOME. Best-effort: presence of the credential file, not a live
   * auth check. Paths are the defaults used by each tool's current release.
   */
  authProbe: string;
}

export const CODING_CLI_SPECS: Record<CodingTool, CodingCliSpec> = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    installCmd: "npm i -g @anthropic-ai/claude-code@latest",
    loginCmd: "claude",
    authProbe: '[ -f "$HOME/.claude/.credentials.json" ] || [ -f "$HOME/.claude.json" ]',
  },
  codex: {
    label: "Codex",
    bin: "codex",
    installCmd: "npm i -g @openai/codex@latest",
    loginCmd: "codex login",
    authProbe: '[ -f "$HOME/.codex/auth.json" ]',
  },
  gemini: {
    label: "Gemini CLI",
    bin: "gemini",
    installCmd: "npm i -g @google/gemini-cli@latest",
    loginCmd: "gemini",
    authProbe: '[ -f "$HOME/.gemini/oauth_creds.json" ]',
  },
  opencode: {
    label: "OpenCode",
    bin: "opencode",
    installCmd: "npm i -g opencode-ai@latest",
    loginCmd: "opencode auth login",
    authProbe: '[ -f "$HOME/.local/share/opencode/auth.json" ]',
  },
};

export interface CodingCliStatus {
  installed: boolean;
  /** First line of `<bin> --version`, when installed. */
  version?: string;
  /** Whether a logged-in credential file was found (best-effort). */
  loggedIn: boolean;
}

/** Build the single shell script that probes all four tools at once. */
export function buildProbeScript(): string {
  const blocks = CODING_TOOLS.map((tool) => {
    const spec = CODING_CLI_SPECS[tool];
    // Tab-delimited line per tool: name, installed(0|1), version, loggedIn(0|1).
    return [
      `if command -v ${spec.bin} >/dev/null 2>&1; then`,
      `  inst=1; ver=$(${spec.bin} --version 2>/dev/null | head -n1 | tr -d '\\t')`,
      `else inst=0; ver=""; fi`,
      `if ${spec.authProbe}; then li=1; else li=0; fi`,
      `printf '%s\\t%s\\t%s\\t%s\\n' '${tool}' "$inst" "$ver" "$li"`,
    ].join("\n");
  });
  return blocks.join("\n");
}

/** Parse the probe script's tab-delimited output into a per-tool status map. */
export function parseProbeOutput(stdout: string): Record<CodingTool, CodingCliStatus> {
  const status = {} as Record<CodingTool, CodingCliStatus>;
  for (const tool of CODING_TOOLS) {
    status[tool] = { installed: false, loggedIn: false };
  }
  for (const line of stdout.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [tool, inst, ver, li] = parts;
    if (!(CODING_TOOLS as string[]).includes(tool)) continue;
    const t = tool as CodingTool;
    const installed = inst === "1";
    status[t] = {
      installed,
      ...(installed && ver.trim() ? { version: ver.trim() } : {}),
      loggedIn: li === "1",
    };
  }
  return status;
}

/** Probe which coding CLIs are installed + logged in for this agent. */
export async function checkCodingClis(
  workspaceDir: string,
  secrets: Map<string, string>
): Promise<Record<CodingTool, CodingCliStatus>> {
  const r = await runAgentShell(workspaceDir, secrets, buildProbeScript());
  if (r.error || !r.ok) {
    // No sandbox / probe failed — report everything as not-installed rather
    // than throwing, so the UI and tool degrade gracefully.
    const empty = {} as Record<CodingTool, CodingCliStatus>;
    for (const tool of CODING_TOOLS) empty[tool] = { installed: false, loggedIn: false };
    return empty;
  }
  return parseProbeOutput(r.stdout);
}

export interface CodingCliInstallResult {
  ok: boolean;
  /** Trimmed install output (stdout+stderr tail), for display. */
  output: string;
  error?: string;
}

/**
 * Install one coding CLI into the agent's workspace. Serialized per agent so two
 * concurrent `npm i -g` runs can't corrupt the shared workspace npm prefix.
 */
export async function installCodingCli(
  agentId: string,
  workspaceDir: string,
  secrets: Map<string, string>,
  tool: CodingTool
): Promise<CodingCliInstallResult> {
  const spec = CODING_CLI_SPECS[tool];
  return withCodingLock(`install:${agentId}`, async () => {
    const r = await runAgentShell(workspaceDir, secrets, spec.installCmd);
    const output = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
    if (r.error) return { ok: false, output, error: r.error };
    if (!r.ok) {
      return {
        ok: false,
        output,
        error: `\`${spec.installCmd}\` exited with code ${r.exitCode ?? "?"}`,
      };
    }
    return { ok: true, output };
  });
}
