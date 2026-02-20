/**
 * Claude Code CLI client — implements the CodingAgentClient interface.
 *
 * Uses the @anthropic-ai/claude-code SDK to spawn Claude Code as a subprocess
 * and stream structured JSON events for real-time display.
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
import { execSync } from "node:child_process";

export interface ClaudeCodeConfig {
  workspacePath?: string | null;
  apiKey?: string;
  model?: string;
  approvalMode?: "full-auto" | "auto-edit";
  timeoutMs?: number;
  maxTurns?: number;
  onEvent?: OnEvent;
}

export class ClaudeCodeClient implements CodingAgentClient {
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async executeTask(
    task: string,
    getHumanResponse?: GetHumanResponse,
    onPermissionRequest?: OnPermissionRequest,
  ): Promise<CodingAgentTaskResult> {
    const sessionId = `claude-code-${Date.now()}`;
    const label = "Claude Code";

    console.log(`[${label}] Starting task (${task.length} chars)...`);

    try {
      // Dynamic import to avoid loading SDK at module init
      const { claude } = await import("@anthropic-ai/claude-code");

      const options: Record<string, unknown> = {
        prompt: task,
        abortController: new AbortController(),
      };

      if (this.config.workspacePath) {
        options.cwd = this.config.workspacePath;
      }
      if (this.config.model) {
        options.model = this.config.model;
      }
      if (this.config.maxTurns) {
        options.maxTurns = this.config.maxTurns;
      }

      // Set approval mode
      if (this.config.approvalMode === "full-auto") {
        options.permissionMode = "acceptEdits";
      }

      // Set up environment with API key if provided
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (this.config.apiKey) {
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      }
      options.env = env;

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let model = this.config.model ?? "unknown";

      // Stream events from Claude Code
      const stream = claude(options as Parameters<typeof claude>[0]);

      for await (const event of stream) {
        const eventObj = event as Record<string, unknown>;
        const eventType = (eventObj.type as string) ?? "unknown";

        // Forward events for streaming display
        if (this.config.onEvent) {
          this.config.onEvent({
            type: eventType,
            properties: eventObj,
          });
        }

        // Accumulate text from assistant messages
        if (eventType === "assistant" && typeof eventObj.content === "string") {
          fullText += eventObj.content;
        } else if (eventType === "assistant" && Array.isArray(eventObj.content)) {
          for (const part of eventObj.content as Array<{ type?: string; text?: string }>) {
            if (part.type === "text" && part.text) {
              fullText += part.text;
            }
          }
        }

        // Accumulate token usage
        if (eventObj.usage) {
          const usage = eventObj.usage as Record<string, number>;
          inputTokens += usage.input_tokens ?? 0;
          outputTokens += usage.output_tokens ?? 0;
        }
        if (eventObj.model) {
          model = eventObj.model as string;
        }
      }

      // Strip completion sentinel
      if (fullText.includes(TASK_COMPLETE_SENTINEL)) {
        fullText = fullText.replace(TASK_COMPLETE_SENTINEL, "").trim();
      }

      // Compute diff via git
      const diff = this.computeGitDiff();

      const usage: CodingAgentTokenUsage = {
        inputTokens,
        outputTokens,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        model,
        provider: "anthropic",
      };

      console.log(`[${label}] Task completed. ${fullText.length} chars output, ${diff?.files?.length ?? 0} files changed.`);

      return {
        success: true,
        sessionId,
        summary: fullText || "Task completed.",
        diff,
        usage,
      };
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
