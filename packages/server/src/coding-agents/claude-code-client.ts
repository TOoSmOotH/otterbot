/**
 * Claude Code client — implements the CodingAgentClient interface.
 *
 * Uses the @anthropic-ai/claude-agent-sdk to spawn Claude Code as a subprocess
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
  /** External abort controller — if provided, used instead of creating a new one */
  abortController?: AbortController;
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
      const { query } = await import("@anthropic-ai/claude-agent-sdk");

      // Build the options object (everything except prompt goes inside options)
      const sdkOptions: Record<string, unknown> = {
        abortController: this.config.abortController ?? new AbortController(),
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: ["user", "project", "local"],
      };

      if (this.config.workspacePath) {
        sdkOptions.cwd = this.config.workspacePath;
      }
      if (this.config.model) {
        sdkOptions.model = this.config.model;
      }
      if (this.config.maxTurns) {
        sdkOptions.maxTurns = this.config.maxTurns;
      }

      // Set approval mode
      if (this.config.approvalMode === "full-auto") {
        sdkOptions.permissionMode = "acceptEdits";
      } else if (onPermissionRequest) {
        // Interactive mode — route permission requests through the UI/chat
        let permSeq = 0;
        sdkOptions.canUseTool = async (
          toolName: string,
          input: Record<string, unknown>,
          ctx: { signal: AbortSignal; suggestions?: Array<{ type: string; [k: string]: unknown }>; toolUseID: string; decisionReason?: string },
        ) => {
          const permissionId = `cc-perm-${++permSeq}-${ctx.toolUseID}`;
          const response = await onPermissionRequest(sessionId, {
            id: permissionId,
            type: toolName,
            title: `${toolName}${ctx.decisionReason ? ` — ${ctx.decisionReason}` : ""}`,
            pattern: input.command as string | undefined,
            metadata: input,
          });

          if (response === "reject") {
            return { behavior: "deny" as const, message: "User denied permission" };
          }
          return {
            behavior: "allow" as const,
            updatedInput: input,
            ...(response === "always" && ctx.suggestions ? { updatedPermissions: ctx.suggestions } : {}),
          };
        };
      }

      // Set up environment with API key if provided
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      if (this.config.apiKey) {
        env.ANTHROPIC_API_KEY = this.config.apiKey;
      }
      sdkOptions.env = env;

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let model = this.config.model ?? "unknown";

      // State tracking for transforming SDK events → OpenCode-compatible events
      let currentMessageId = "";
      let messageSeq = 0;
      const contentBlockParts = new Map<number, { partId: string; type: string; text: string }>();

      const emit = this.config.onEvent;

      // Stream events from Claude Code
      const stream = query({ prompt: task, options: sdkOptions } as Parameters<typeof query>[0]);

      for await (const event of stream) {
        const eventObj = event as Record<string, unknown>;
        const eventType = (eventObj.type as string) ?? "unknown";

        // --- Transform SDK events into OpenCode-compatible format ---

        if (eventType === "stream_event" && emit) {
          const rawEvent = eventObj.event as Record<string, unknown> | undefined;
          if (!rawEvent) continue;
          const rawType = rawEvent.type as string;

          if (rawType === "message_start") {
            const msg = rawEvent.message as Record<string, unknown> | undefined;
            currentMessageId = (msg?.id as string) ?? `cc-msg-${++messageSeq}`;
            contentBlockParts.clear();
          } else if (rawType === "content_block_start") {
            const index = rawEvent.index as number ?? 0;
            const contentBlock = rawEvent.content_block as Record<string, unknown> | undefined;
            const blockType = (contentBlock?.type as string) ?? "text";
            const partId = `${sessionId}-${currentMessageId}-${index}`;

            let mappedType = "text";
            if (blockType === "thinking") mappedType = "reasoning";
            else if (blockType === "tool_use") mappedType = "tool";

            contentBlockParts.set(index, { partId, type: mappedType, text: "" });

            // For tool_use blocks, emit an initial delta with the tool name
            if (blockType === "tool_use" && contentBlock?.name) {
              emit({
                type: "message.part.delta",
                properties: {
                  sessionID: sessionId,
                  messageID: currentMessageId,
                  partID: partId,
                  field: "text",
                  delta: `Tool: ${contentBlock.name as string}\n`,
                },
              });
            }
          } else if (rawType === "content_block_delta") {
            const index = rawEvent.index as number ?? 0;
            const delta = rawEvent.delta as Record<string, unknown> | undefined;
            const deltaType = delta?.type as string;
            const part = contentBlockParts.get(index);

            if (delta && part) {
              let deltaText = "";
              let field = "text";

              if (deltaType === "text_delta") {
                deltaText = (delta.text as string) ?? "";
                field = "text";
              } else if (deltaType === "thinking_delta") {
                deltaText = (delta.thinking as string) ?? "";
                field = "reasoning";
              } else if (deltaType === "input_json_delta") {
                deltaText = (delta.partial_json as string) ?? "";
                field = "text";
              }

              if (deltaText) {
                part.text += deltaText;
                emit({
                  type: "message.part.delta",
                  properties: {
                    sessionID: sessionId,
                    messageID: currentMessageId,
                    partID: part.partId,
                    field,
                    delta: deltaText,
                  },
                });
              }
            }
          } else if (rawType === "content_block_stop") {
            const index = rawEvent.index as number ?? 0;
            const part = contentBlockParts.get(index);
            if (part) {
              emit({
                type: "message.part.updated",
                properties: {
                  part: {
                    id: part.partId,
                    messageID: currentMessageId,
                    sessionID: sessionId,
                    type: part.type === "reasoning" ? "reasoning" : part.type === "tool" ? "tool" : "text",
                    text: part.text,
                  },
                },
              });
            }
          } else if (rawType === "message_stop") {
            // Emit message.updated so emitCodingAgentEvent can build the full message
            emit({
              type: "message.updated",
              properties: {
                info: {
                  id: currentMessageId,
                  role: "assistant",
                  sessionID: sessionId,
                },
              },
            });
          }

          // Also extract usage from message_delta events
          if (rawType === "message_delta") {
            const usage = rawEvent.usage as Record<string, number> | undefined;
            if (usage) {
              inputTokens += usage.input_tokens ?? 0;
              outputTokens += usage.output_tokens ?? 0;
            }
          }
        } else if (eventType === "assistant") {
          // Complete assistant message — accumulate text
          if (typeof eventObj.content === "string") {
            fullText += eventObj.content;
          } else if (Array.isArray(eventObj.content)) {
            for (const part of eventObj.content as Array<{ type?: string; text?: string }>) {
              if (part.type === "text" && part.text) {
                fullText += part.text;
              }
            }
          }

          // Also emit message.updated for the complete message if no stream events did
          if (emit) {
            const msgObj = eventObj.message as Record<string, unknown> | undefined;
            const msgId = (msgObj?.id as string) ?? (currentMessageId || `cc-msg-${++messageSeq}`);
            emit({
              type: "message.updated",
              properties: {
                info: {
                  id: msgId,
                  role: "assistant",
                  sessionID: sessionId,
                },
              },
            });
          }
        } else if (eventType === "tool_progress" && emit) {
          // Tool progress — emit as a delta on the current tool part
          const progressText = (eventObj.text as string) ?? (eventObj.output as string) ?? "";
          if (progressText && currentMessageId) {
            // Find the most recent tool part
            let toolPart: { partId: string; type: string; text: string } | undefined;
            for (const p of contentBlockParts.values()) {
              if (p.type === "tool") toolPart = p;
            }
            if (toolPart) {
              toolPart.text += progressText;
              emit({
                type: "message.part.delta",
                properties: {
                  sessionID: sessionId,
                  messageID: currentMessageId,
                  partID: toolPart.partId,
                  field: "text",
                  delta: progressText,
                },
              });
            }
          }
        }

        // Accumulate token usage from top-level usage field
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
