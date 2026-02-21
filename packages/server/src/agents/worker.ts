import { nanoid } from "nanoid";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  /** Callback for raw terminal data from PTY sessions (Claude Code) */
  onTerminalData?: (agentId: string, data: string) => void;
  /** Called when a PTY session is registered/unregistered for socket routing */
  onPtySessionRegistered?: (agentId: string, client: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient) => void;
  onPtySessionUnregistered?: (agentId: string) => void;
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
  private _onPtySessionRegistered?: (agentId: string, client: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient) => void;
  private _onPtySessionUnregistered?: (agentId: string) => void;

  /** Abort controller for the current task — used by abort() to cancel running work */
  private _taskAbortController: AbortController | null = null;
  /** Reference to the Claude Code AbortController (stored in executeExternalCodingAgent) */
  private _codingAgentAbortController: AbortController | null = null;
  /** Reference to the OpenCode client (for abort) */
  private _openCodeClient: { abort: (sessionId: string) => Promise<void>; sessionId?: string } | null = null;
  /** Reference to the PTY client (for abort/input routing) */
  private _ptyClient: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient | null = null;
  /** Guard against re-entrant terminal analysis */
  private _analyzingTerminal = false;

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

    // Read project guidelines (AGENTS.md or CLAUDE.md) from the workspace
    let projectGuidelines = "";
    if (this.workspacePath) {
      const MAX_GUIDELINES_CHARS = 4000;
      for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
        const filepath = join(this.workspacePath, filename);
        try {
          if (existsSync(filepath)) {
            let content = readFileSync(filepath, "utf-8");
            if (content.length > MAX_GUIDELINES_CHARS) {
              content = content.slice(0, MAX_GUIDELINES_CHARS) + "\n... (truncated)";
            }
            projectGuidelines = `[PROJECT_GUIDELINES]\n${content}\n[/PROJECT_GUIDELINES]\n\n`;
            console.log(`[Worker ${this.id}] Loaded project guidelines from ${filename} (${content.length} chars)`);
            break;
          }
        } catch {
          // Silently skip if file can't be read
        }
      }
    }

    const preInstalledContext =
      `IMPORTANT — Pre-installed tools (do NOT install these, they are already available):\n` +
      `- Node.js (v22), npm, pnpm (via corepack)\n` +
      `- Playwright with Chromium — already installed globally, do NOT run \`npx playwright install\` or install browsers\n` +
      `- Puppeteer — already installed globally with shared Chromium (PUPPETEER_EXECUTABLE_PATH is set), do NOT reinstall. Just \`import puppeteer from 'puppeteer'\`.\n` +
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
        projectGuidelines + preInstalledContext + completionInstruction + `\n${task}`
      : preInstalledContext + completionInstruction + `\n${task}`;

    // Mark worker as actively working on the graph
    this.setStatus(AgentStatus.Acting);

    // Emit session-start event
    this._onCodingAgentEvent?.(this.id, "", {
      type: "__session-start",
      properties: { task, projectId: this.projectId ?? "", agentType: "opencode" },
    });

    const interactiveMode = getConfig("opencode:interactive") === "true";

    // Only wire up getHumanResponse when interactive mode is on.
    // In YOLO mode, OpenCode runs single-turn (no follow-up prompts).
    const getHumanResponse = interactiveMode && this._onCodingAgentAwaitingInput
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
    // In YOLO mode, permissions auto-approve via the default "always" in opencode-client.
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
    const IDLE_TIMEOUT_MS = 5000;     // 5 seconds of no output = Claude is waiting
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
   * Uses the Worker's LLM to classify the terminal state and responds appropriately.
   */
  private async analyzeTerminalState(
    terminalOutput: string,
    ptyClient: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient,
  ): Promise<void> {
    if (this._analyzingTerminal) return;
    this._analyzingTerminal = true;

    try {
      const cleanOutput = stripAnsi(terminalOutput);

      const { text } = await this.think(
        `You are monitoring a Claude Code terminal session. The terminal has been idle for 5 seconds.

Analyze the terminal output below and determine what state Claude is in:

1. WAITING_FOR_PERMISSION — Claude is asking to approve a file edit, command execution, or tool use
2. WAITING_FOR_INPUT — Claude is asking a question and waiting for user response
3. TASK_COMPLETE — Claude has finished the task and is showing the REPL prompt (>) with no pending work
4. STILL_WORKING — Claude is still processing (e.g., loading, thinking)

Respond with EXACTLY one of these formats:
- PERMISSION: <what Claude is asking permission for>
- INPUT: <the question Claude is asking>
- COMPLETE: <brief summary of what was done>
- WORKING: <what Claude appears to be doing>

TERMINAL OUTPUT (last portion):
${cleanOutput.slice(-4000)}`,
      );

      if (text.startsWith("PERMISSION:")) {
        await this.handleTerminalPermission(text.slice(11).trim(), ptyClient);
      } else if (text.startsWith("INPUT:")) {
        await this.handleTerminalInput(text.slice(6).trim(), ptyClient);
      } else if (text.startsWith("COMPLETE:")) {
        this.handleTerminalComplete(text.slice(9).trim(), ptyClient);
      }
      // WORKING: do nothing, wait for more output
    } finally {
      this._analyzingTerminal = false;
    }
  }

  /** Handle permission prompts from Claude Code */
  private async handleTerminalPermission(
    description: string,
    ptyClient: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient,
  ): Promise<void> {
    const approvalMode = getConfig("claude-code:approval_mode") ?? "full-auto";

    if (approvalMode === "full-auto") {
      // Auto-approve: send "y" + Enter
      ptyClient.writeInput("y\n");
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
        ptyClient.writeInput(response + "\n");
      }
    } else {
      // No callback — auto-approve
      ptyClient.writeInput("y\n");
    }
  }

  /** Handle general input prompts from Claude Code */
  private async handleTerminalInput(
    question: string,
    ptyClient: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient,
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
        ptyClient.writeInput(response + "\n");
      }
    }
  }

  /** Handle task completion — send /exit to close the REPL */
  private handleTerminalComplete(
    summary: string,
    ptyClient: import("../coding-agents/claude-code-pty-client.js").ClaudeCodePtyClient,
  ): void {
    console.log(`[Worker ${this.id}] Terminal session appears complete: ${summary}`);
    ptyClient.writeInput("/exit\n");
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
