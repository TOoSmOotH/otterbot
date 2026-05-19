import { mkdirSync } from "node:fs";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { buildSandboxPlan } from "./shell.js";

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
 */
const INTERACTIVE_SHELL = ["/bin/sh", "-c", "exec bash -il 2>/dev/null || exec sh -i"];

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
  size: Partial<TerminalSize> = {}
): OpenTerminalResult {
  try {
    mkdirSync(workspaceDir, { recursive: true });
  } catch {
    /* the spawn below will surface any real problem */
  }

  const built = buildSandboxPlan(workspaceDir, secrets, INTERACTIVE_SHELL, {
    interactive: true,
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
