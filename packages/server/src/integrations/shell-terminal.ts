import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { buildSandboxPlan, ensureWorkspace } from "./shell.js";

/**
 * Interactive pseudo-terminals into an agent's workspace — the human-facing
 * sibling of the `shell_exec` tool. A shell runs inside the very same OS
 * sandbox (bwrap / sandbox-exec) confined to `data/profiles/<id>/workspace`.
 */

/** Terminal size used before the browser reports its real dimensions. */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * The shell launched inside the sandbox: prefer an interactive login `bash`,
 * fall back to `sh -i` on systems without bash. `exec` keeps it as PID 1 of the
 * sandbox so `--die-with-parent` reaps it cleanly.
 *
 * The bash-presence check is what's redirected to /dev/null — never the shell
 * itself: an interactive shell writes its prompt (PS1) to stderr, so silencing
 * stderr leaves only a blinking cursor with no prompt.
 */
const INTERACTIVE_SHELL = [
  "/bin/sh",
  "-c",
  "command -v bash >/dev/null 2>&1 && exec bash -il; exec sh -i",
];

export interface TerminalSize {
  cols: number;
  rows: number;
}

export type OpenTerminalResult = { pty: pty.IPty } | { error: string };

/**
 * Open an interactive PTY running a shell confined to the agent's workspace.
 * Returns `{ error }` when no OS sandbox is available — never runs unconfined.
 */
export function openTerminal(
  workspaceDir: string,
  secrets: Map<string, string>,
  size: Partial<TerminalSize> = {},
  opts: { projectRepoPath?: string | null } = {}
): OpenTerminalResult {
  ensureWorkspace(workspaceDir);

  // The shell starts in HOME (/workspace) so per-tool CLI logins land there;
  // a project member can `cd /project` to reach the shared tree.
  const built = buildSandboxPlan(workspaceDir, secrets, INTERACTIVE_SHELL, {
    interactive: true,
    projectRepoPath: opts.projectRepoPath ?? undefined,
  });
  if ("error" in built) return { error: built.error };

  const { plan } = built;
  try {
    const term = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: size.cols ?? DEFAULT_COLS,
      rows: size.rows ?? DEFAULT_ROWS,
      cwd: plan.cwd,
      env: plan.env as { [key: string]: string },
    });
    return { pty: term };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // "posix_spawnp failed" means the pty library's native helper could not be
    // launched — its native binary is missing. Reinstalling fetches a prebuilt.
    const hint = /posix_spawn/i.test(message)
      ? " — the pty native binary is missing; reinstall dependencies (`pnpm install`)"
      : "";
    return { error: `failed to start the terminal: ${message}${hint}` };
  }
}
