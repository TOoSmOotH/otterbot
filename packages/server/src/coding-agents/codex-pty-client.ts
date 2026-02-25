/**
 * Codex PTY client — spawns the `codex` CLI in a pseudo-terminal
 * and streams raw terminal output to the browser via Socket.IO + xterm.js.
 *
 * Implements the CodingAgentClient interface so it can be used as a drop-in
 * replacement for the subprocess-based CodexClient.
 */

import type {
  CodingAgentClient,
  CodingAgentTaskResult,
} from "./coding-agent-client.js";
import { computeGitDiff } from "../utils/git.js";
import { extractPtySummary } from "../utils/terminal.js";
import { getConfig } from "../auth/auth.js";

/** Ring buffer size for late-joining clients (~100KB) */
const RING_BUFFER_SIZE = 100 * 1024;

export interface CodexPtyConfig {
  workspacePath?: string | null;
  /** Callback for raw PTY data — stream to Socket.IO clients */
  onData?: (data: string) => void;
  /** Callback when process exits */
  onExit?: (exitCode: number) => void;
}

export class CodexPtyClient implements CodingAgentClient {
  private config: CodexPtyConfig;
  private ptyProcess: any | null = null;
  private ringBuffer = "";
  private _killed = false;

  constructor(config: CodexPtyConfig) {
    this.config = config;
  }

  async executeTask(task: string): Promise<CodingAgentTaskResult> {
    const sessionId = `codex-pty-${Date.now()}`;
    const label = "Codex (PTY)";

    console.log(`[${label}] Starting task (${task.length} chars)...`);

    try {
      // Dynamic import to avoid loading native module at module init
      const nodePty = await import("node-pty");

      // Build environment
      const env: Record<string, string> = { ...(process.env as Record<string, string>) };

      const apiKey = getConfig("codex:api_key");
      if (apiKey) {
        env.OPENAI_API_KEY = apiKey;
      }

      const ghToken = getConfig("github:token");
      if (ghToken) {
        env.GH_TOKEN = ghToken;
        env.GITHUB_TOKEN = ghToken;
      }

      // Build args
      const args: string[] = [];

      // Set approval mode
      const approvalMode = getConfig("codex:approval_mode") ?? "full-auto";
      args.push("--approval-mode", approvalMode);

      // Set model if configured
      const model = getConfig("codex:model");
      if (model) {
        args.push("--model", model);
      }

      // Add the task as positional argument
      args.push(task);

      const cwd = this.config.workspacePath || process.cwd();

      this.ptyProcess = nodePty.spawn("codex", args, {
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
        summary: `Codex failed: ${errMsg}`,
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


}
