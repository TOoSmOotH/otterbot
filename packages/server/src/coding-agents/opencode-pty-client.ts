/**
 * OpenCode PTY client — spawns the `opencode` CLI in a pseudo-terminal
 * and streams raw terminal output to the browser via Socket.IO + xterm.js.
 *
 * Implements the CodingAgentClient interface so it can be used as a drop-in
 * replacement for the SDK-based OpenCodeClient.
 */

import type {
  CodingAgentClient,
  CodingAgentTaskResult,
  CodingAgentDiff,
} from "./coding-agent-client.js";
import { execSync } from "node:child_process";
import { getConfig } from "../auth/auth.js";

/** Ring buffer size for late-joining clients (~100KB) */
const RING_BUFFER_SIZE = 100 * 1024;

export interface OpenCodePtyConfig {
  workspacePath?: string | null;
  /** Callback for raw PTY data — stream to Socket.IO clients */
  onData?: (data: string) => void;
  /** Callback when process exits */
  onExit?: (exitCode: number) => void;
}

export class OpenCodePtyClient implements CodingAgentClient {
  private config: OpenCodePtyConfig;
  private ptyProcess: any | null = null;
  private ringBuffer = "";
  private _killed = false;

  constructor(config: OpenCodePtyConfig) {
    this.config = config;
  }

  async executeTask(task: string): Promise<CodingAgentTaskResult> {
    const sessionId = `opencode-pty-${Date.now()}`;
    const label = "OpenCode (PTY)";

    console.log(`[${label}] Starting task (${task.length} chars)...`);

    try {
      // Dynamic import to avoid loading native module at module init
      const nodePty = await import("node-pty");

      // Ensure OpenCode config is up-to-date before spawning
      const { ensureOpenCodeConfig } = await import("../opencode/opencode-manager.js");
      ensureOpenCodeConfig();

      // Build environment
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };

      // Resolve API key from the configured provider
      const { getProviderRow } = await import("../settings/settings.js");
      const providerId = getConfig("opencode:provider_id");
      if (providerId) {
        const row = getProviderRow(providerId);
        if (row?.apiKey) {
          env.OPENCODE_PROVIDER_API_KEY = row.apiKey;
        }
      }

      const ghToken = getConfig("github:token");
      if (ghToken) {
        env.GH_TOKEN = ghToken;
        env.GITHUB_TOKEN = ghToken;
      }

      // Spawn bare `opencode` (the full interactive TUI), then type the task
      // into the input prompt. `opencode run` produces plain output without
      // the rich Bubble Tea TUI.
      const args: string[] = [];

      const cwd = this.config.workspacePath || process.cwd();

      this.ptyProcess = nodePty.spawn("opencode", args, {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd,
        env,
      });

      // Track whether we've sent the task to the TUI input prompt.
      // We accumulate output bytes and wait for the TUI to fully render
      // before typing the task. OpenCode's Bubble Tea TUI needs time to
      // initialize its layout, input field, and status bar.
      let taskSent = false;
      let accumulatedBytes = 0;
      const TUI_READY_THRESHOLD = 500; // bytes — enough for initial TUI render
      let readyTimer: NodeJS.Timeout | null = null;

      return await new Promise<CodingAgentTaskResult>((resolve) => {
        this.ptyProcess!.onData((data: string) => {
          // Wait for enough TUI output before submitting the task.
          // Each data chunk resets the timer — we want a quiet period
          // after the initial render burst before typing.
          if (!taskSent) {
            accumulatedBytes += data.length;
            if (accumulatedBytes >= TUI_READY_THRESHOLD) {
              if (readyTimer) clearTimeout(readyTimer);
              readyTimer = setTimeout(() => {
                if (taskSent) return;
                taskSent = true;
                console.log(`[OpenCode (PTY)] TUI ready (${accumulatedBytes} bytes received), submitting task...`);
                // Type the task and press Enter to submit
                this.ptyProcess?.write(task + "\r");
              }, 500); // 500ms quiet period after last output
            }
          }

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
          const diff = this.computeGitDiff();

          const success = exitCode === 0 || !this._killed;

          resolve({
            success,
            sessionId,
            summary: success ? "Task completed." : `Process exited with code ${exitCode}`,
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
        summary: `OpenCode failed: ${errMsg}`,
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

  /** Compute file diffs via git in the workspace directory */
  private computeGitDiff(): CodingAgentDiff | null {
    if (!this.config.workspacePath) return null;

    try {
      const output = execSync("git diff --stat --numstat HEAD", {
        cwd: this.config.workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();

      if (!output) return null;

      const files = output.split("\n").map((line) => {
        const parts = line.split("\t");
        return {
          path: parts[2] ?? parts[0] ?? "",
          additions: parseInt(parts[0] ?? "0", 10) || 0,
          deletions: parseInt(parts[1] ?? "0", 10) || 0,
        };
      }).filter((f) => f.path);

      return { files };
    } catch {
      return null;
    }
  }
}
