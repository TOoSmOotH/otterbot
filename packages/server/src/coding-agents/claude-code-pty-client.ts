/**
 * Claude Code PTY client — spawns the `claude` CLI in a pseudo-terminal
 * and streams raw terminal output to the browser via Socket.IO + xterm.js.
 *
 * Implements the CodingAgentClient interface so it can be used as a drop-in
 * replacement for the SDK-based ClaudeCodeClient.
 */

import { extractPtySummary } from "../utils/terminal.js";
import type {
  CodingAgentClient,
  CodingAgentTaskResult,
} from "./coding-agent-client.js";
import { computeGitDiff } from "../utils/git.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "../auth/auth.js";

/** Ring buffer size for late-joining clients (~100KB) */
const RING_BUFFER_SIZE = 100 * 1024;

export interface ClaudeCodePtyConfig {
  workspacePath?: string | null;
  /** Callback for raw PTY data — stream to Socket.IO clients */
  onData?: (data: string) => void;
  /** Callback when process exits */
  onExit?: (exitCode: number) => void;
}

export class ClaudeCodePtyClient implements CodingAgentClient {
  private config: ClaudeCodePtyConfig;
  private ptyProcess: any | null = null;
  private ringBuffer = "";
  private _killed = false;

  constructor(config: ClaudeCodePtyConfig) {
    this.config = config;
  }

  async executeTask(task: string): Promise<CodingAgentTaskResult> {
    const sessionId = `claude-code-pty-${Date.now()}`;
    const label = "Claude Code (PTY)";

    console.log(`[${label}] Starting task (${task.length} chars)...`);

    try {
      // Dynamic import to avoid loading native module at module init
      const nodePty = await import("node-pty");

      // Build environment
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };
      const apiKey = getConfig("claude-code:api_key");
      if (apiKey) {
        env.ANTHROPIC_API_KEY = apiKey;
      }
      const ghToken = getConfig("github:token");
      if (ghToken) {
        env.GH_TOKEN = ghToken;
        env.GITHUB_TOKEN = ghToken;
      }

      // Determine approval mode
      const approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";

      // Always use positional arg (REPL mode) so the terminal renders
      // Claude Code's full interactive TUI. The -p flag produces plain text
      // output which defeats the purpose of the PTY terminal.
      const args: string[] = [task];

      // Add model flag if configured
      const model = getConfig("claude-code:model");
      if (model) {
        args.unshift("--model", model);
      }

      if (approvalMode === "full-auto") {
        args.unshift("--dangerously-skip-permissions");
        // Ensure the "are you sure?" confirmation for --dangerously-skip-permissions
        // is suppressed. Claude CLI checks ~/.claude/settings.json for this flag.
        this.ensureSkipPermissionPrompt();
      }

      const cwd = this.config.workspacePath || process.cwd();

      this.ptyProcess = nodePty.spawn("claude", args, {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd,
        env,
      });

      return await new Promise<CodingAgentTaskResult>((resolve) => {
        this.ptyProcess!.onData((data: string) => {
          // Append to ring buffer (trim to size)
          this.ringBuffer += data;
          if (this.ringBuffer.length > RING_BUFFER_SIZE) {
            this.ringBuffer = this.ringBuffer.slice(-RING_BUFFER_SIZE);
          }

          // Stream to callback
          this.config.onData?.(data);
        });

        this.ptyProcess!.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
          console.log(`[${label}] Process exited with code ${exitCode}`);
          this.config.onExit?.(exitCode);

          // Compute diff via git
          const diff = this.config.workspacePath ? computeGitDiff(this.config.workspacePath) : null;

          const success = exitCode === 0 || !this._killed;

          resolve({
            success,
            sessionId,
            summary: success ? extractPtySummary(this.ringBuffer) : `Process exited with code ${exitCode}`,
            diff,
            usage: null,
          });

          this.ptyProcess = null;
        });
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${label}] Task failed:`, errMsg);

      return {
        success: false,
        sessionId,
        summary: `Claude Code failed: ${errMsg}`,
        diff: null,
        usage: null,
        error: errMsg,
      };
    }
  }

  /** Write user keystrokes to PTY stdin */
  writeInput(data: string): void {
    this.ptyProcess?.write(data);
  }

  /** Resize PTY dimensions */
  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(cols, rows);
    } catch {
      // Ignore resize errors (process may have exited)
    }
  }

  /** Get the ring buffer contents for late-joining clients */
  getReplayBuffer(): string {
    return this.ringBuffer;
  }

  /** Kill the PTY process (marks result as failed) */
  kill(): void {
    if (!this.ptyProcess) return;
    this._killed = true;

    try {
      this.ptyProcess.kill("SIGTERM");
    } catch {
      // Already dead
    }

    // Force kill after 3 seconds
    setTimeout(() => {
      try {
        this.ptyProcess?.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 3000);
  }

  /** Gracefully terminate the PTY process (marks result as successful) */
  gracefulExit(): void {
    if (!this.ptyProcess) return;
    // Don't set _killed so the exit is treated as successful
    try {
      this.ptyProcess.kill("SIGTERM");
    } catch {
      // Already dead
    }

    // Force kill after 3 seconds if SIGTERM didn't work
    setTimeout(() => {
      try {
        this.ptyProcess?.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 3000);
  }

  /**
   * Ensure the Claude CLI settings have skipDangerousModePermissionPrompt: true
   * so the one-time "are you sure?" dialog is suppressed in non-interactive PTY usage.
   */
  private ensureSkipPermissionPrompt(): void {
    try {
      const home = process.env.HOME || process.env.USERPROFILE || "";
      const settingsDir = join(home, ".claude");
      const settingsPath = join(settingsDir, "settings.json");

      let settings: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        } catch {
          // Corrupted file — overwrite
        }
      }

      if (settings.skipDangerousModePermissionPrompt === true) return;

      settings.skipDangerousModePermissionPrompt = true;
      mkdirSync(settingsDir, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
      console.log("[Claude Code PTY] Set skipDangerousModePermissionPrompt in ~/.claude/settings.json");
    } catch (err) {
      console.warn("[Claude Code PTY] Failed to set skipDangerousModePermissionPrompt:", err);
    }
  }


}
