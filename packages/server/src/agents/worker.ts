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

/** Strip ANSI escape codes from terminal output for LLM analysis */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

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
  /** Callback for raw terminal data from PTY sessions */
  onTerminalData?: (agentId: string, data: string) => void;
  /** Called when a PTY session is registered/unregistered for socket routing */
  onPtySessionRegistered?: (agentId: string, client: PtyClient) => void;
  onPtySessionUnregistered?: (agentId: string) => void;
}

/** Common interface for PTY clients (ClaudeCodePtyClient, OpenCodePtyClient) */
export interface PtyClient {
  writeInput(data: string): void;
  resize(cols: number, rows: number): void;
  getReplayBuffer(): string;
  kill(): void;
  gracefulExit(): void;
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
  private _onTerminalData?: (agentId: string, data: string) => void;
  private _onPtySessionRegistered?: (agentId: string, client: PtyClient) => void;
  private _onPtySessionUnregistered?: (agentId: string) => void;

  /** Abort controller for the current task — used by abort() to cancel running work */
  private _taskAbortController: AbortController | null = null;
  /** Reference to the Claude Code AbortController (stored in executeExternalCodingAgent) */
  private _codingAgentAbortController: AbortController | null = null;
  /** Reference to the PTY client (for abort/input routing) */
  private _ptyClient: PtyClient | null = null;
  /** Guard against re-entrant terminal analysis */
  private _analyzingTerminal = false;
  /** Set to true after sending /exit to prevent repeated analysis */
  private _terminalExiting = false;

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
    this._onTerminalData = deps.onTerminalData;
    this._onPtySessionRegistered = deps.onPtySessionRegistered;
    this._onPtySessionUnregistered = deps.onPtySessionUnregistered;
  }

  /**
   * Abort the currently running task. Called by TeamLead.stopWorker().
   * Cancels the coding agent or LLM stream, emits session-end, sends report, and destroys.
   */
  abort(): void {
    console.log(`[Worker ${this.id}] abort() called — cancelling running task`);

    // 1. Cancel the task-level abort controller (causes handleTask to throw)
    if (this._taskAbortController) {
      this._taskAbortController.abort();
      this._taskAbortController = null;
    }

    // 2. Cancel the external coding agent if running
    if (this._ptyClient) {
      this._ptyClient.kill();
      this._onPtySessionUnregistered?.(this.id);
      this._ptyClient = null;
    }
    if (this._codingAgentAbortController) {
      this._codingAgentAbortController.abort();
      this._codingAgentAbortController = null;
    }

    // 3. Emit session-end with cancelled status for coding agents
    if (CODING_AGENT_REGISTRY_IDS.has(this.registryEntryId!) && this.registryEntryId !== "builtin-coder") {
      this._onCodingAgentEvent?.(this.id, "", {
        type: "__session-end",
        properties: { status: "cancelled", diff: null, error: "Manually stopped by user" },
      });
    }

    // 4. Report cancellation to the parent TeamLead
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, "WORKER CANCELLED: Task was manually stopped by user.");
    }

    // 5. Clean up
    this.destroy();
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

  /**
   * Execute a task using OpenCode via PTY (terminal passthrough).
   * Spawns the `opencode run` CLI in a pseudo-terminal and streams raw output.
   */
  private async executeOpenCodePtyTask(task: string): Promise<string> {
    // Bail out early if no provider is configured
    const providerId = getConfig("opencode:provider_id");
    const model = getConfig("opencode:model");
    if (!providerId && !model) {
      console.warn(`[Worker ${this.id}] OpenCode not configured (no provider/model), falling back to think()`);
      return "";
    }

    const { OpenCodePtyClient } = await import("../coding-agents/opencode-pty-client.js");

    // Terminal output buffer and idle detection for monitoring
    let terminalBuffer = "";
    let idleTimer: NodeJS.Timeout | null = null;
    const IDLE_TIMEOUT_MS = 10000; // 10 seconds of no output = agent is waiting
    const MAX_BUFFER_CHARS = 8000;    // Keep last ~8KB for LLM analysis

    const ptyClient = new OpenCodePtyClient({
      workspacePath: this.workspacePath,
      onData: (data) => {
        this._onTerminalData?.(this.id, data);

        // Accumulate output for monitoring
        terminalBuffer += data;
        if (terminalBuffer.length > MAX_BUFFER_CHARS) {
          terminalBuffer = terminalBuffer.slice(-MAX_BUFFER_CHARS);
        }

        // Reset idle timer on each chunk
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => this.analyzeTerminalState(terminalBuffer, ptyClient), IDLE_TIMEOUT_MS);
      },
      onExit: () => {
        // Clear idle timer to avoid dangling analysis after exit
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      },
    });

    this._ptyClient = ptyClient;
    this._terminalExiting = false;

    // Register PTY session for socket routing
    this._onPtySessionRegistered?.(this.id, ptyClient);

    this.setStatus(AgentStatus.Acting);

    // Emit session-start event
    this._onCodingAgentEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "", agentType: "opencode" },
    });

    console.log(`[Worker ${this.id}] Sending task to OpenCode PTY (${task.length} chars)...`);

    const result = await ptyClient.executeTask(task);
    console.log(`[Worker ${this.id}] OpenCode PTY result: success=${result.success}, diff=${result.diff?.files?.length ?? 0} files`);

    // Unregister PTY session
    this._onPtySessionUnregistered?.(this.id);
    this._ptyClient = null;

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
      ? `OpenCode completed successfully.\n\nSummary: ${result.summary}\n\nFiles changed: ${result.diff?.files?.length ?? 0}`
      : `OpenCode failed: ${result.error ?? "Unknown error"}\n\n${result.summary}`;
  }

  private async executeCodingAgentTask(task: string): Promise<string> {
    const agentType = this.getCodingAgentType();

    switch (agentType) {
      case "opencode":
        return this.executeOpenCodePtyTask(task);
      case "claude-code": {
        return this.executeClaudeCodePtyTask(task);
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
   * Execute a task using Claude Code via PTY (terminal passthrough).
   * Spawns the `claude` CLI in a pseudo-terminal and streams raw output.
   */
  private async executeClaudeCodePtyTask(task: string): Promise<string> {
    // Bail out early if no API key is configured (for api-key auth mode)
    const authMode = getConfig("claude-code:auth_mode") ?? "api-key";
    if (authMode === "api-key" && !getConfig("claude-code:api_key")) {
      console.warn(`[Worker ${this.id}] Claude Code not configured (no api_key), falling back to think()`);
      return "";
    }

    const { ClaudeCodePtyClient } = await import("../coding-agents/claude-code-pty-client.js");

    // Terminal output buffer and idle detection for monitoring
    let terminalBuffer = "";
    let idleTimer: NodeJS.Timeout | null = null;
    const approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";
    const IDLE_TIMEOUT_MS = 10000; // 10 seconds of no output = Claude is waiting
    const MAX_BUFFER_CHARS = 8000;    // Keep last ~8KB for LLM analysis

    const ptyClient = new ClaudeCodePtyClient({
      workspacePath: this.workspacePath,
      onData: (data) => {
        this._onTerminalData?.(this.id, data);

        // Accumulate output for monitoring
        terminalBuffer += data;
        if (terminalBuffer.length > MAX_BUFFER_CHARS) {
          terminalBuffer = terminalBuffer.slice(-MAX_BUFFER_CHARS);
        }

        // Reset idle timer on each chunk
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => this.analyzeTerminalState(terminalBuffer, ptyClient), IDLE_TIMEOUT_MS);
      },
      onExit: () => {
        // Clear idle timer to avoid dangling analysis after exit
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
      },
    });

    this._ptyClient = ptyClient;
    this._terminalExiting = false;

    // Register PTY session for socket routing
    this._onPtySessionRegistered?.(this.id, ptyClient);

    this.setStatus(AgentStatus.Acting);

    // Emit session-start event
    this._onCodingAgentEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "", agentType: "claude-code" },
    });

    console.log(`[Worker ${this.id}] Sending task to Claude Code PTY (${task.length} chars)...`);

    const result = await ptyClient.executeTask(task);
    console.log(`[Worker ${this.id}] Claude Code PTY result: success=${result.success}, diff=${result.diff?.files?.length ?? 0} files`);

    // Unregister PTY session
    this._onPtySessionUnregistered?.(this.id);
    this._ptyClient = null;

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
      ? `Claude Code completed successfully.\n\nSummary: ${result.summary}\n\nFiles changed: ${result.diff?.files?.length ?? 0}`
      : `Claude Code failed: ${result.error ?? "Unknown error"}\n\n${result.summary}`;
  }

  /**
   * Analyze terminal output when idle to detect permission prompts, questions, or task completion.
   * Uses fast regex checks first, falls back to LLM only in interactive mode for ambiguous cases.
   */
  private async analyzeTerminalState(
    terminalOutput: string,
    ptyClient: PtyClient,
  ): Promise<void> {
    if (this._analyzingTerminal || this._terminalExiting) return;
    this._analyzingTerminal = true;

    try {
      const cleanOutput = stripAnsi(terminalOutput);
      const lastChunk = cleanOutput.slice(-2000);
      const approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";

      // --- Fast regex-based detection ---

      // Terminal output uses \r within lines for cursor movement, so split on both \n and \r
      // to get individual visual lines, then filter out blanks.
      const segments = lastChunk.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
      const tailSegments = segments.slice(-20);

      // Claude Code REPL prompt: "❯" (U+276F) or ">" alone on a segment
      const isReplPrompt = tailSegments.some(l => /^[❯>⏵]\s*$/.test(l) || l === "❯" || l === ">");
      // Completion phrases: "Cogitated for Xs", "Baked for Xs", "Thought for Xs", cost summaries
      const hasCompletionSignal = tailSegments.some(l =>
        /total\s*(cost|tokens|input|output)/i.test(l) ||
        /\$\d+\.\d+/.test(l) ||
        /(cogitated|baked|thought|pondered|brewed)\s+for\s+\d+/i.test(l),
      );

      console.log(`[Worker ${this.id}] Terminal idle check — tail segments: ${JSON.stringify(tailSegments.slice(-8))}, prompt=${isReplPrompt}, completion=${hasCompletionSignal}`);

      if (isReplPrompt || hasCompletionSignal) {
        console.log(`[Worker ${this.id}] Terminal idle — detected completion (prompt=${isReplPrompt}, signal=${hasCompletionSignal})`);
        this.handleTerminalComplete("Task finished (detected REPL prompt)", ptyClient);
        return;
      }

      // In full-auto mode, only completion detection matters — permissions are handled by CLI flag
      if (approvalMode === "full-auto") {
        return;
      }

      // --- Interactive mode: detect permission/input prompts via regex first ---

      // Permission prompts typically contain "Allow" or "Yes/No" patterns
      const permissionMatch = tailSegments.some(l =>
        /\b(allow|approve|permit|accept)\b.*\?\s*$/i.test(l) ||
        /\b(y\/n|yes\/no)\b/i.test(l),
      );
      if (permissionMatch) {
        const promptLine = tailSegments.find(l => /\b(allow|approve|permit|accept|y\/n|yes\/no)\b/i.test(l)) ?? "";
        await this.handleTerminalPermission(promptLine, ptyClient);
        return;
      }

      // For anything ambiguous in interactive mode, use LLM analysis
      const { text } = await this.think(
        `You are monitoring a Claude Code terminal session running in interactive mode. The terminal has been idle for 10+ seconds.

Look at the VERY END of the terminal output. Is Claude:
1. Asking the user a QUESTION and waiting for typed input? (There must be an explicit question with cursor)
2. Still working / thinking / between operations?

Respond with EXACTLY one line:
- INPUT: <the question being asked>
- WORKING: <what Claude appears to be doing>

Default to WORKING unless there is a clear, explicit question.

TERMINAL OUTPUT (last lines):
${cleanOutput.slice(-2000)}`,
      );

      if (text.startsWith("INPUT:")) {
        await this.handleTerminalInput(text.slice(6).trim(), ptyClient);
      }
    } finally {
      this._analyzingTerminal = false;
    }
  }

  /** Handle permission prompts from Claude Code */
  private async handleTerminalPermission(
    description: string,
    ptyClient: PtyClient,
  ): Promise<void> {
    const approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";

    if (approvalMode === "full-auto") {
      // Auto-approve: send "y" + Enter
      ptyClient.writeInput("y\r");
      return;
    }

    // Interactive mode: relay to user via the awaiting-input callback
    if (this._onCodingAgentAwaitingInput) {
      this.setStatus(AgentStatus.AwaitingInput);
      this._onCodingAgentEvent?.(this.id, "", {
        type: "__awaiting-input",
        properties: { prompt: `Claude Code is asking for permission:\n\n${description}` },
      });

      const response = await this._onCodingAgentAwaitingInput(
        this.id, "",
        `Claude Code is asking for permission:\n\n${description}\n\nRespond with: yes, no, or always`,
      );

      this.setStatus(AgentStatus.Acting);

      if (response) {
        ptyClient.writeInput(response + "\r");
      }
    } else {
      // No callback — auto-approve
      ptyClient.writeInput("y\r");
    }
  }

  /** Handle general input prompts from Claude Code */
  private async handleTerminalInput(
    question: string,
    ptyClient: PtyClient,
  ): Promise<void> {
    if (this._onCodingAgentAwaitingInput) {
      this.setStatus(AgentStatus.AwaitingInput);
      this._onCodingAgentEvent?.(this.id, "", {
        type: "__awaiting-input",
        properties: { prompt: question },
      });

      const response = await this._onCodingAgentAwaitingInput(this.id, "", question);
      this.setStatus(AgentStatus.Acting);

      if (response) {
        ptyClient.writeInput(response + "\r");
      }
    }
  }

  /** Handle task completion — terminate the PTY process gracefully */
  private handleTerminalComplete(
    summary: string,
    ptyClient: PtyClient,
  ): void {
    if (this._terminalExiting) return;
    this._terminalExiting = true;
    console.log(`[Worker ${this.id}] Terminal session appears complete: ${summary}`);
    // Kill the process directly — typing /exit doesn't work reliably because
    // Claude Code's REPL autocomplete menu intercepts the input.
    ptyClient.gracefulExit();
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

    // Create a shared abort controller for the coding agent subprocess
    const codingAbortController = new AbortController();
    this._codingAgentAbortController = codingAbortController;

    const clientConfig: Record<string, unknown> = {
      workspacePath: this.workspacePath,
      timeoutMs,
      maxTurns,
      abortController: codingAbortController,
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

    // Set up abort controller for this task
    this._taskAbortController = new AbortController();
    this._externalAbortController = this._taskAbortController;

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

    // Clean up abort controllers
    this._taskAbortController = null;
    this._externalAbortController = null;
    this._codingAgentAbortController = null;

    // Worker is a one-shot agent — mark as done after completing the task
    this.setStatus(AgentStatus.Done);
  }
}
