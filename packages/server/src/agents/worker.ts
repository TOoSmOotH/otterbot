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
  onOpenCodeEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  onOpenCodeAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  onOpenCodePermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;
}

export class Worker extends BaseAgent {
  private toolNames: string[];
  private workspacePath: string | null;
  private _onOpenCodeEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  private _onOpenCodeAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  private _onOpenCodePermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;

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
    this._onOpenCodeEvent = deps.onOpenCodeEvent;
    this._onOpenCodeAwaitingInput = deps.onOpenCodeAwaitingInput;
    this._onOpenCodePermissionRequest = deps.onOpenCodePermissionRequest;
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
        this._onOpenCodeEvent?.(this.id, sid, event);
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
    this._onOpenCodeEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "" },
    });

    // Build human response callback for interactive sessions (only when interactive mode is on)
    const interactiveMode = getConfig("opencode:interactive") === "true";
    const getHumanResponse = interactiveMode && this._onOpenCodeAwaitingInput
      ? async (sessionId: string, assistantText: string) => {
          this.setStatus(AgentStatus.AwaitingInput);
          // Emit awaiting-input event so the frontend shows the prompt
          this._onOpenCodeEvent?.(this.id, sessionId, {
            type: "__awaiting-input",
            properties: { prompt: assistantText },
          });
          const response = await this._onOpenCodeAwaitingInput!(this.id, sessionId, assistantText);
          this.setStatus(AgentStatus.Acting);
          return response;
        }
      : undefined;

    // Build permission request callback for interactive sessions
    const onPermissionRequest = interactiveMode && this._onOpenCodePermissionRequest
      ? async (sid: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => {
          this.setStatus(AgentStatus.AwaitingInput);
          // Emit permission-request event so the frontend shows the prompt
          this._onOpenCodeEvent?.(this.id, sid, {
            type: "__permission-request",
            properties: { permission },
          });
          const response = await this._onOpenCodePermissionRequest!(this.id, sid, permission);
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
    this._onOpenCodeEvent?.(this.id, result.sessionId, {
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
