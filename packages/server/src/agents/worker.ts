import { nanoid } from "nanoid";
import {
  type GearConfig,
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@otterbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import type { MessageBus } from "../bus/message-bus.js";
import { createTools } from "../tools/tool-factory.js";
import { debug } from "../utils/debug.js";
import { getConfig } from "../auth/auth.js";
import { getDb, schema } from "../db/index.js";
import { TASK_COMPLETE_SENTINEL } from "../tools/opencode-client.js";

export interface WorkerDependencies {
  id?: string;
  name?: string | null;
  bus: MessageBus;
  projectId: string | null;
  parentId: string;
  registryEntryId: string;
  modelPackId?: string | null;
  gearConfig?: GearConfig | null;
  model: string;
  provider: string;
  systemPrompt: string;
  workspacePath: string | null;
  toolNames: string[];
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
  onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;
}

/** Set of registry entry IDs that are coding agents */
export const CODING_AGENT_REGISTRY_IDS = new Set([
  "builtin-opencode-coder",
  "builtin-claude-code-coder",
  "builtin-codex-coder",
  "builtin-coder",
]);

export class Worker extends BaseAgent {
  private toolNames: string[];
  private workspacePath: string | null;
  private _onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  private _onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  private _onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;

  constructor(deps: WorkerDependencies) {
    const options: AgentOptions = {
      id: deps.id,
      name: deps.name,
      role: AgentRole.Worker,
      parentId: deps.parentId,
      projectId: deps.projectId,
      registryEntryId: deps.registryEntryId,
      modelPackId: deps.modelPackId,
      gearConfig: deps.gearConfig,
      model: deps.model,
      provider: deps.provider,
      systemPrompt: deps.systemPrompt,
      workspacePath: deps.workspacePath,
      onStatusChange: deps.onStatusChange,
      onAgentStream: deps.onAgentStream,
      onAgentThinking: deps.onAgentThinking,
      onAgentThinkingEnd: deps.onAgentThinkingEnd,
      onAgentToolCall: deps.onAgentToolCall,
    };
    super(options, deps.bus);
    this.toolNames = deps.toolNames;
    this.workspacePath = deps.workspacePath;
    this._onCodingAgentEvent = deps.onCodingAgentEvent;
    this._onCodingAgentAwaitingInput = deps.onCodingAgentAwaitingInput;
    this._onCodingAgentPermissionRequest = deps.onCodingAgentPermissionRequest;
  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Directive) {
      await this.handleTask(message);
    } else if (message.type === MessageType.StatusRequest) {
      this.sendMessage(
        message.fromAgentId,
        MessageType.StatusResponse,
        this.getStatusSummary(),
        undefined,
        undefined,
        message.correlationId,
      );
    }
  }

  override getStatusSummary(): string {
    return `Worker ${this.id} [${this.status}]`;
  }

  protected getTools(): Record<string, unknown> {
    if (!this.workspacePath || !this.projectId || this.toolNames.length === 0) {
      return {};
    }

    return createTools(this.toolNames, {
      workspacePath: this.workspacePath,
      projectId: this.projectId,
      agentId: this.id,
      role: AgentRole.Worker,
    });
  }

  /** Determine the coding agent type from the registry entry ID */
  private getCodingAgentType(): "opencode" | "claude-code" | "codex" {
    switch (this.registryEntryId) {
      case "builtin-claude-code-coder": return "claude-code";
      case "builtin-codex-coder": return "codex";
      default: return "opencode";
    }
  }

  private async executeOpenCodeTask(task: string): Promise<string> {
    const apiUrl = getConfig("opencode:api_url");
    if (!apiUrl) {
      console.warn(`[Worker ${this.id}] OpenCode not configured (no api_url), falling back to think()`);
      return "";
    }

    // Dynamic imports to avoid loading @opencode-ai/sdk at module init
    // (the SDK uses CommonJS require() which fails in ESM context at top-level)
    const { OpenCodeClient } = await import("../tools/opencode-client.js");

    const username = getConfig("opencode:username") ?? undefined;
    const password = getConfig("opencode:password") ?? undefined;
    const timeoutMs = parseInt(getConfig("opencode:timeout_ms") ?? "1200000", 10);
    const maxIterations = parseInt(getConfig("opencode:max_iterations") ?? "50", 10);

    let currentSessionId = "";
    const client = new OpenCodeClient({
      apiUrl,
      username,
      password,
      timeoutMs,
      maxIterations,
      onEvent: (event) => {
        // Extract session ID from event properties if we don't have it yet
        const eventSessionId = event.properties?.sessionID as string | undefined;
        if (eventSessionId && !currentSessionId) {
          currentSessionId = eventSessionId;
        }
        const sid = currentSessionId || eventSessionId || "";
        this._onCodingAgentEvent?.(this.id, sid, event);
      },
    });

    const preInstalledContext =
      `IMPORTANT — Pre-installed tools (do NOT install these, they are already available):\n` +
      `- Node.js (v22), npm, pnpm (via corepack)\n` +
      `- Playwright with Chromium — already installed, do NOT run \`npx playwright install\` or install browsers\n` +
      `- Puppeteer — already installed with shared Chromium, do NOT reinstall\n` +
      `- Go, Rust, Python 3, Java, Ruby, git, gh (GitHub CLI), SQLite 3, build-essential\n`;

    const completionInstruction =
      `\nIMPORTANT — Completion signal: When you have fully completed ALL tasks and have no more work to do, ` +
      `you MUST output the following exact string on its own line as the very last thing you write:\n` +
      `${TASK_COMPLETE_SENTINEL}\n` +
      `This signals to the system that your work is finished. Do not output this string until everything is done.\n`;

    const taskWithContext = this.workspacePath
      ? `IMPORTANT: All files must be created/edited inside this directory: ${this.workspacePath}\n` +
        `Use absolute paths rooted at ${this.workspacePath} (e.g. ${this.workspacePath}/src/main.go).\n` +
        `Do NOT use /home/user, /app, or any other directory.\n\n` +
        preInstalledContext + completionInstruction + `\n${task}`
      : preInstalledContext + completionInstruction + `\n${task}`;

    // Mark worker as actively working on the graph
    this.setStatus(AgentStatus.Acting);

    // Emit session-start event
    this._onCodingAgentEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "", agentType: "opencode" },
    });

    // Always wire up getHumanResponse so OpenCode can ask the user questions
    // even when running in YOLO mode (no tool-permission prompts).
    const getHumanResponse = this._onCodingAgentAwaitingInput
      ? async (sessionId: string, assistantText: string) => {
          this.setStatus(AgentStatus.AwaitingInput);
          // Emit awaiting-input event so the frontend shows the prompt
          this._onCodingAgentEvent?.(this.id, sessionId, {
            type: "__awaiting-input",
            properties: { prompt: assistantText },
          });
          const response = await this._onCodingAgentAwaitingInput!(this.id, sessionId, assistantText);
          this.setStatus(AgentStatus.Acting);
          return response;
        }
      : undefined;

    // Only wire up permission request callback when interactive mode is on.
    // In YOLO mode, permissions auto-approve via the default "once" in opencode-client.
    const interactiveMode = getConfig("opencode:interactive") === "true";
    const onPermissionRequest = interactiveMode && this._onCodingAgentPermissionRequest
      ? async (sid: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => {
          this.setStatus(AgentStatus.AwaitingInput);
          // Emit permission-request event so the frontend shows the prompt
          this._onCodingAgentEvent?.(this.id, sid, {
            type: "__permission-request",
            properties: { permission },
          });
          const response = await this._onCodingAgentPermissionRequest!(this.id, sid, permission);
          this.setStatus(AgentStatus.Acting);
          return response;
        }
      : undefined;

    console.log(`[Worker ${this.id}] Sending task directly to OpenCode (${taskWithContext.length} chars)...`);
    const result = await client.executeTask(taskWithContext, getHumanResponse, onPermissionRequest);
    console.log(`[Worker ${this.id}] OpenCode result: success=${result.success}, sessionId=${result.sessionId}, diff=${result.diff?.files?.length ?? 0} files`);

    // Persist token usage from OpenCode
    if (result.usage) {
      try {
        const db = getDb();
        db.insert(schema.tokenUsage)
          .values({
            id: nanoid(),
            agentId: this.id,
            provider: result.usage.provider,
            model: result.usage.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cost: result.usage.cost,
            projectId: this.projectId,
            timestamp: new Date().toISOString(),
          })
          .run();
        console.log(`[Worker ${this.id}] OpenCode token usage persisted: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out, cost=${result.usage.cost} microcents`);
      } catch (err) {
        console.error(`[Worker ${this.id}] Failed to persist OpenCode token usage:`, err);
      }
    }

    // Emit session-end event
    this._onCodingAgentEvent?.(this.id, result.sessionId, {
      type: "__session-end",
      properties: {
        status: result.success ? "completed" : "error",
        diff: result.diff?.files ?? null,
        error: result.error,
      },
    });

    const { formatOpenCodeResult } = await import("../tools/opencode-task.js");
    return formatOpenCodeResult(result);
  }

  private async executeCodingAgentTask(task: string): Promise<string> {
    const agentType = this.getCodingAgentType();

    switch (agentType) {
      case "opencode":
        return this.executeOpenCodeTask(task);
      case "claude-code": {
        const { ClaudeCodeClient } = await import("../coding-agents/claude-code-client.js");
        return this.executeExternalCodingAgent(task, agentType, ClaudeCodeClient);
      }
      case "codex": {
        const { CodexClient } = await import("../coding-agents/codex-client.js");
        return this.executeExternalCodingAgent(task, agentType, CodexClient);
      }
      default:
        return "";
    }
  }

  /**
   * Generic execution method for external coding agents (Claude Code, Codex).
   * Uses the CodingAgentClient interface for unified handling.
   */
  private async executeExternalCodingAgent(
    task: string,
    agentType: "claude-code" | "codex",
    ClientClass: { new(config: any): any },
  ): Promise<string> {
    const configPrefix = agentType === "claude-code" ? "claude-code" : "codex";

    // Bail out early if no API key is configured (for api-key auth mode)
    const authMode = getConfig(`${configPrefix}:auth_mode`) ?? "api-key";
    if (authMode === "api-key" && !getConfig(`${configPrefix}:api_key`)) {
      const label = agentType === "claude-code" ? "Claude Code" : "Codex";
      console.warn(`[Worker ${this.id}] ${label} not configured (no api_key), falling back to think()`);
      return "";
    }
    const timeoutMs = parseInt(getConfig(`${configPrefix}:timeout_ms`) ?? "1200000", 10);
    const maxTurns = parseInt(getConfig(`${configPrefix}:max_turns`) ?? "50", 10);

    const clientConfig: Record<string, unknown> = {
      workspacePath: this.workspacePath,
      timeoutMs,
      maxTurns,
      onEvent: (event: { type: string; properties: Record<string, unknown> }) => {
        this._onCodingAgentEvent?.(this.id, "", event);
      },
    };

    // Add agent-specific config
    if (agentType === "claude-code") {
      clientConfig.model = getConfig("claude-code:model") ?? undefined;
      clientConfig.approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";
      const authMode = getConfig("claude-code:auth_mode") ?? "api-key";
      if (authMode === "api-key") {
        clientConfig.apiKey = getConfig("claude-code:api_key") ?? undefined;
      }
    } else {
      clientConfig.model = getConfig("codex:model") ?? undefined;
      clientConfig.approvalMode = getConfig("codex:approval_mode") ?? "full-auto";
      const authMode = getConfig("codex:auth_mode") ?? "api-key";
      if (authMode === "api-key") {
        clientConfig.apiKey = getConfig("codex:api_key") ?? undefined;
      }
    }

    const client = new ClientClass(clientConfig);

    this.setStatus(AgentStatus.Acting);

    // Emit session-start event
    this._onCodingAgentEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "", agentType },
    });

    const getHumanResponse = this._onCodingAgentAwaitingInput
      ? async (sessionId: string, assistantText: string) => {
          this.setStatus(AgentStatus.AwaitingInput);
          this._onCodingAgentEvent?.(this.id, sessionId, {
            type: "__awaiting-input",
            properties: { prompt: assistantText },
          });
          const response = await this._onCodingAgentAwaitingInput!(this.id, sessionId, assistantText);
          this.setStatus(AgentStatus.Acting);
          return response;
        }
      : undefined;

    const onPermissionRequest = this._onCodingAgentPermissionRequest
      ? async (sid: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => {
          this.setStatus(AgentStatus.AwaitingInput);
          this._onCodingAgentEvent?.(this.id, sid, {
            type: "__permission-request",
            properties: { permission },
          });
          const response = await this._onCodingAgentPermissionRequest!(this.id, sid, permission);
          this.setStatus(AgentStatus.Acting);
          return response;
        }
      : undefined;

    const label = agentType === "claude-code" ? "Claude Code" : "Codex";
    console.log(`[Worker ${this.id}] Sending task to ${label} (${task.length} chars)...`);

    const result = await client.executeTask(task, getHumanResponse, onPermissionRequest);
    console.log(`[Worker ${this.id}] ${label} result: success=${result.success}, diff=${result.diff?.files?.length ?? 0} files`);

    // Persist token usage
    if (result.usage) {
      try {
        const db = getDb();
        db.insert(schema.tokenUsage)
          .values({
            id: nanoid(),
            agentId: this.id,
            provider: result.usage.provider,
            model: result.usage.model,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cost: result.usage.cost,
            projectId: this.projectId,
            timestamp: new Date().toISOString(),
          })
          .run();
      } catch (err) {
        console.error(`[Worker ${this.id}] Failed to persist ${label} token usage:`, err);
      }
    }

    // Emit session-end event
    this._onCodingAgentEvent?.(this.id, result.sessionId, {
      type: "__session-end",
      properties: {
        status: result.success ? "completed" : "error",
        diff: result.diff?.files ?? null,
        error: result.error,
      },
    });

    return result.success
      ? `${label} completed successfully.\n\nSummary: ${result.summary}\n\nFiles changed: ${result.diff?.files?.length ?? 0}`
      : `${label} failed: ${result.error ?? "Unknown error"}\n\n${result.summary}`;
  }

  private async handleTask(message: BusMessage) {
    console.log(`[Worker ${this.id}] handleTask starting (registry=${this.registryEntryId})`);
    let text: string;
    try {
      if (CODING_AGENT_REGISTRY_IDS.has(this.registryEntryId!) && this.registryEntryId !== "builtin-coder" && this.workspacePath) {
        text = await this.executeCodingAgentTask(message.content);
        // Empty string means the agent wasn't configured — fall back to think()
        if (text === "") {
          const result = await this.think(
            message.content,
            (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
            (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
            (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
          );
          text = result.text;
        } else {
          console.log(`[Worker ${this.id}] Direct coding agent call completed — ${text.length} chars`);
        }
      } else {
        const result = await this.think(
          message.content,
          (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
          (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
          (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
        );
        text = result.text;
        debug("worker", `think() result — timedOut=${result.timedOut} textLen=${result.text.length} hadToolCalls=${result.hadToolCalls} agent=${this.id}`);

        if (result.timedOut || text.trim() === "") {
          const reason = result.timedOut ? "LLM timeout" : "empty response";
          console.warn(`[Worker ${this.id}] Task produced no output (${reason})`);
          text = `WORKER ERROR: Task produced no output (likely ${reason})`;
        }

        console.log(`[Worker ${this.id}] think() completed — text=${text.length} chars, hadToolCalls=${result.hadToolCalls}`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[Worker ${this.id}] Task failed:`, reason);
      text = `WORKER ERROR: Task failed — ${reason}`;
    }

    // Always report back so the Team Lead can evaluate and clean up
    if (this.parentId) {
      console.log(`[Worker ${this.id}] Sending report to parent ${this.parentId} (${text.length} chars): ${text.slice(0, 300)}`);
      this.sendMessage(this.parentId, MessageType.Report, text);
    } else {
      console.warn(`[Worker ${this.id}] No parentId — report not sent!`);
    }

    // Worker is a one-shot agent — mark as done after completing the task
    this.setStatus(AgentStatus.Done);
  }
}
