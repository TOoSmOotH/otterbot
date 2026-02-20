/**
 * Codex CLI client — implements the CodingAgentClient interface.
 *
 * Spawns the `codex` CLI as a child process and parses its output
 * for structured results.
 */

import type {
  CodingAgentClient,
  CodingAgentTaskResult,
  CodingAgentDiff,
  CodingAgentTokenUsage,
  GetHumanResponse,
  OnPermissionRequest,
  OnEvent,
} from "./coding-agent-client.js";
import { TASK_COMPLETE_SENTINEL } from "./coding-agent-client.js";
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";

export interface CodexConfig {
  workspacePath?: string | null;
  apiKey?: string;
  model?: string;
  approvalMode?: "full-auto" | "suggest" | "ask";
  timeoutMs?: number;
  maxTurns?: number;
  onEvent?: OnEvent;
}

export class CodexClient implements CodingAgentClient {
  private config: CodexConfig;

  constructor(config: CodexConfig) {
    this.config = config;
  }

  async executeTask(
    task: string,
    getHumanResponse?: GetHumanResponse,
    onPermissionRequest?: OnPermissionRequest,
  ): Promise<CodingAgentTaskResult> {
    const sessionId = `codex-${Date.now()}`;
    const label = "Codex";

    console.log(`[${label}] Starting task (${task.length} chars)...`);

    try {
      const args: string[] = [
        "--quiet",
      ];

      // Set approval mode
      const approvalMode = this.config.approvalMode ?? "full-auto";
      args.push("--approval-mode", approvalMode);

      // Set model if specified
      if (this.config.model) {
        args.push("--model", this.config.model);
      }

      // Add the task as the prompt
      args.push(task);

      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (this.config.apiKey) {
        env.OPENAI_API_KEY = this.config.apiKey;
      }

      const cwd = this.config.workspacePath ?? process.cwd();
      const timeoutMs = this.config.timeoutMs ?? 1_200_000;

      const result = await this.runCodexProcess(args, env, cwd, timeoutMs);

      // Strip completion sentinel
      let summary = result.stdout;
      if (summary.includes(TASK_COMPLETE_SENTINEL)) {
        summary = summary.replace(TASK_COMPLETE_SENTINEL, "").trim();
      }

      // Compute diff via git
      const diff = this.computeGitDiff();

      console.log(`[${label}] Task completed. ${summary.length} chars output, ${diff?.files?.length ?? 0} files changed.`);

      if (result.exitCode !== 0) {
        return {
          success: false,
          sessionId,
          summary: summary || `Codex exited with code ${result.exitCode}`,
          diff,
          usage: null,
          error: result.stderr || `Exit code ${result.exitCode}`,
        };
      }

      return {
        success: true,
        sessionId,
        summary: summary || "Task completed.",
        diff,
        usage: null,
      };
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

  /** Run codex CLI as a child process and collect output */
  private runCodexProcess(
    args: string[],
    env: Record<string, string>,
    cwd: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn("codex", args, {
        env,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;

        // Forward streaming output as events
        if (this.config.onEvent) {
          this.config.onEvent({
            type: "message.part.delta",
            properties: {
              field: "text",
              delta: text,
            },
          });
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        try { child.kill("SIGTERM"); } catch { /* best-effort */ }
        setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* best-effort */ }
        }, 5000);
        resolve({ stdout, stderr: stderr + "\nProcess timed out", exitCode: -1 });
      }, timeoutMs);

      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
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
