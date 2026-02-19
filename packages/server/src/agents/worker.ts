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

export interface WorkerDependencies {
  id?: string;
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
}

export class Worker extends BaseAgent {
  private toolNames: string[];
  private workspacePath: string | null;

  constructor(deps: WorkerDependencies) {
    const options: AgentOptions = {
      id: deps.id,
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

    const client = new OpenCodeClient({
      apiUrl,
      username,
      password,
      timeoutMs,
      maxIterations,
    });

    const taskWithContext = this.workspacePath
      ? `IMPORTANT: All files must be created/edited inside this directory: ${this.workspacePath}\n` +
        `Use absolute paths rooted at ${this.workspacePath} (e.g. ${this.workspacePath}/src/main.go).\n` +
        `Do NOT use /home/user, /app, or any other directory.\n\n${task}`
      : task;

    console.log(`[Worker ${this.id}] Sending task directly to OpenCode (${taskWithContext.length} chars)...`);
    const result = await client.executeTask(taskWithContext);
    console.log(`[Worker ${this.id}] OpenCode result: success=${result.success}, sessionId=${result.sessionId}, diff=${result.diff?.files?.length ?? 0} files`);

    const { formatOpenCodeResult } = await import("../tools/opencode-task.js");
    return formatOpenCodeResult(result);
  }

  private async handleTask(message: BusMessage) {
    console.log(`[Worker ${this.id}] handleTask starting (registry=${this.registryEntryId})`);
    let text: string;
    try {
      if (this.registryEntryId === "builtin-opencode-coder" && this.workspacePath) {
        text = await this.executeOpenCodeTask(message.content);
        // Empty string means OpenCode wasn't configured — fall back to think()
        if (text === "") {
          const result = await this.think(
            message.content,
            (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
            (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
            (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
          );
          text = result.text;
        } else {
          console.log(`[Worker ${this.id}] Direct OpenCode call completed — ${text.length} chars`);
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
