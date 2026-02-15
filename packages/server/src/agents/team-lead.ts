import { nanoid } from "nanoid";
import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
  type KanbanTask,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { Worker } from "./worker.js";
import { getDb, schema } from "../db/index.js";
import { Registry } from "../registry/registry.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq } from "drizzle-orm";
import { getConfig } from "../auth/auth.js";
import { execSync } from "node:child_process";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { isDesktopEnabled } from "../desktop/desktop.js";
import { TEAM_LEAD_PROMPT } from "./prompts/team-lead.js";
import { getRandomModelPackId } from "../models3d/model-packs.js";

/** Tool descriptions for environment context injection */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  file_read: "Read files from the workspace",
  file_write: "Create and edit files in the workspace",
  shell_exec: "Execute shell commands in the workspace directory",
  web_search: "Search the web for information",
  web_browse: "Browse web pages with a headless browser (Playwright)",
  install_package: "Install apt or npm packages (persisted across restarts)",
  opencode_task: "Delegate complex coding tasks to OpenCode (autonomous AI coding agent)",
};

/** Find the Chromium binary — checks wrapper script, then Playwright install path */
let _chromiumPath: string | null | undefined;
function findChromiumPath(): string | null {
  if (_chromiumPath !== undefined) return _chromiumPath;
  try {
    // Check for our wrapper script first
    execSync("which chromium-browser", { stdio: "pipe" });
    _chromiumPath = "chromium-browser";
    return _chromiumPath;
  } catch { /* not found */ }
  try {
    // Fall back to finding Playwright's Chromium directly
    const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? `${process.env.HOME ?? "/root"}/.cache/ms-playwright`;
    const result = execSync(
      `find ${browsersPath} -name chrome -type f -path '*/chrome-linux*/chrome' 2>/dev/null | head -1`,
      { stdio: "pipe" },
    ).toString().trim();
    _chromiumPath = result || null;
    return _chromiumPath;
  } catch {
    _chromiumPath = null;
    return null;
  }
}

/** Build environment context to append to worker system prompts */
function buildEnvironmentContext(toolNames: string[]): string {
  const sections: string[] = [];

  // Tools available
  const toolLines = toolNames
    .map((t) => `- ${t}: ${TOOL_DESCRIPTIONS[t] ?? t}`)
    .join("\n");
  if (toolLines) {
    sections.push(`## Available Tools\n${toolLines}`);
  }

  // Desktop environment
  if (isDesktopEnabled()) {
    const hasShell = toolNames.includes("shell_exec");
    const chromium = findChromiumPath();
    const browserInfo = chromium
      ? `\nChromium is already installed at \`${chromium}\`. Do NOT try to install a browser — it is already available.`
      : `\nNo browser is pre-installed on the desktop. Use install_package to install one if needed.`;
    sections.push(
      `## Desktop Environment` +
      `\nA full XFCE4 desktop is running on DISPLAY=:99, viewable by the user via the web UI.` +
      browserInfo +
      (hasShell && chromium
        ? `\nTo launch the browser on the desktop: \`${chromium} --no-sandbox --disable-dev-shm-usage https://example.com &\``
        : "") +
      `\nThe user can see everything on the desktop in real-time.`,
    );
  }

  // sudo availability and installation guidance
  if (toolNames.includes("shell_exec")) {
    const sudoMode = process.env.SUDO_MODE ?? "restricted";
    if (sudoMode === "full") {
      sections.push(`## System Access\nsudo is available with full privileges (no password required).`);
    } else {
      sections.push(`## System Access\nsudo is available for: apt-get, npm, tee, gpg, install. Use install_package tool when possible.`);
    }

    const reservedPort = process.env.PORT ?? "62626";
    sections.push(
      `## Reserved Ports\n` +
      `**Port ${reservedPort} is reserved for the Smoothbot server and MUST NOT be used by your applications.** ` +
      `Choose a different port (e.g. 4000, 5000, 8080). Commands that reference port ${reservedPort} will be blocked.`,
    );

    sections.push(
      `## Dependency Installation\n` +
      `**CRITICAL: Always install project dependencies before building, testing, or running.**\n` +
      `- **Node.js:** Run \`npm install\` in the project directory before \`npm run dev\`, \`npm run build\`, \`npm test\`, etc.\n` +
      `- **Python:** Run \`pip install -r requirements.txt\` before running scripts.\n` +
      `- **Go:** Run \`go mod download\` before building.\n` +
      `- **Rust:** \`cargo build\` handles deps automatically.\n` +
      `If a command fails with "not found" or "Cannot find module", install dependencies and retry.`,
    );

    sections.push(
      `## Software Installation\n` +
      `**IMPORTANT: Install language runtimes and tools into the home directory, NOT system paths.**\n` +
      `Do NOT write to \`/usr/local/\`, \`/opt/\`, or other system directories — use \`$HOME\` instead.\n` +
      `- **Go:** Download the tarball and extract to \`$HOME/go\`. Set \`export GOROOT=$HOME/go\` and \`export PATH=$HOME/go/bin:$PATH\`.\n` +
      `- **Rust:** Use \`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\` (installs to \`$HOME/.rustup\` and \`$HOME/.cargo\` by default).\n` +
      `- **Node.js/npm:** If not already available, use \`nvm\` or download and extract to \`$HOME/.local/\`.\n` +
      `- **Python packages:** Use \`pip install --user\` or a virtualenv in the workspace.\n` +
      `- **Other tools:** Install to \`$HOME/.local/bin/\` and add to PATH.\n` +
      `Always update \`$PATH\` in the same shell session after installing.`,
    );
  }

  if (sections.length === 0) return "";
  return "\n\n---\n# Environment\n" + sections.join("\n\n");
}

export interface TeamLeadDependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  projectId: string;
  parentId: string;
  modelPackId?: string | null;
  onAgentSpawned?: (agent: BaseAgent) => void;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onKanbanChange?: (event: "created" | "updated" | "deleted", task: KanbanTask) => void;
  onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
}

const MAX_CONTINUATION_CYCLES = 5;

export class TeamLead extends BaseAgent {
  private workers: Map<string, Worker> = new Map();
  private workspace: WorkspaceManager;
  private verificationRequested = false;
  private deploymentRequested = false;
  /** Per-think-cycle call counts — prevents tools from being called repeatedly within a single streamText run */
  private _toolCallCounts = new Map<string, number>();
  private _pendingWorkerReport = new Map<string, string>();
  private onAgentSpawned?: (agent: BaseAgent) => void;
  private onKanbanChange?: (event: "created" | "updated" | "deleted", task: KanbanTask) => void;

  constructor(deps: TeamLeadDependencies) {
    const registry = new Registry();
    const tlEntry = registry.get("builtin-team-lead");
    const options: AgentOptions = {
      role: AgentRole.TeamLead,
      parentId: deps.parentId,
      projectId: deps.projectId,
      modelPackId: deps.modelPackId ?? null,
      model:
        getConfig("team_lead_model") ??
        getConfig("coo_model") ??
        "claude-sonnet-4-5-20250929",
      provider:
        getConfig("team_lead_provider") ??
        getConfig("coo_provider") ??
        "anthropic",
      systemPrompt: tlEntry?.systemPrompt ?? TEAM_LEAD_PROMPT,
      onStatusChange: deps.onStatusChange,
      onAgentStream: deps.onAgentStream,
      onAgentThinking: deps.onAgentThinking,
      onAgentThinkingEnd: deps.onAgentThinkingEnd,
      onAgentToolCall: deps.onAgentToolCall,
    };
    super(options, deps.bus);
    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
    this.onKanbanChange = deps.onKanbanChange;

  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Directive) {
      await this.handleDirective(message);
    } else if (message.type === MessageType.Report) {
      await this.handleWorkerReport(message);
    } else if (message.type === MessageType.StatusRequest) {
      await this.handleStatusRequest(message);
    }
  }

  private async handleDirective(message: BusMessage) {
    this.verificationRequested = false;
    this.deploymentRequested = false;
    const { text } = await this.thinkWithContinuation(
      message.content,
      (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
      (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
      (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
    );

    // Report plan/progress back to COO
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }
  }

  /**
   * Detect whether a worker report indicates failure.
   * Returns true if the report contains clear failure signals.
   */
  private isFailureReport(report: string): boolean {
    const lower = report.toLowerCase();
    const failureSignals = [
      "worker error:",
      "task failed",
      "not found",
      "command not found",
      "error:",
      "failed to",
      "could not",
      "unable to",
      "exit code: 1",
      "permission denied",
      "enoent",
      "segmentation fault",
    ];
    return failureSignals.some((signal) => lower.includes(signal));
  }

  /**
   * Safety net: if the LLM didn't move the reporting task, force-move it
   * programmatically so it never stays stuck in in_progress.
   * For failed tasks, appends a failure summary to the description so the
   * next worker gets context about what went wrong.
   */
  private ensureTaskMoved(taskId: string, workerReport: string): void {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (!task || task.column !== "in_progress") return; // LLM already moved it

    const failed = this.isFailureReport(workerReport);
    const targetColumn = failed ? "backlog" : "done";
    const assignee = failed ? "" : task.assigneeAgentId;

    console.warn(
      `[TeamLead ${this.id}] Safety net: LLM did not move task "${task.title}" (${taskId}). ` +
      `Force-moving to "${targetColumn}" (report ${failed ? "indicates failure" : "looks successful"}).`,
    );

    // For failures, enrich the task description with what went wrong
    const updates: { column: string; assigneeAgentId: string; description?: string; completionReport?: string } = {
      column: targetColumn,
      assigneeAgentId: assignee ?? "",
    };

    if (!failed) {
      updates.completionReport = workerReport;
    }

    if (failed) {
      const snippet = workerReport.length > 500
        ? workerReport.slice(-500)
        : workerReport;
      const existing = task.description ?? "";
      updates.description = existing +
        `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${snippet}\n` +
        `--- Analyze the error above and fix the root cause in your next attempt. ---`;
    }

    this.updateKanbanTask(taskId, updates);

    // If force-moved to done, check for newly unblocked tasks
    if (targetColumn === "done") {
      this.checkUnblockedTasks(taskId);
    }
  }

  private async handleWorkerReport(message: BusMessage) {
    // Find the reporting worker's task (read-only — do NOT auto-mark as done)
    let reportingTaskTitle: string | null = null;
    let reportingTaskId: string | null = null;
    if (message.fromAgentId && this.projectId) {
      const db = getDb();
      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, this.projectId))
        .all()
        .find((t) => t.assigneeAgentId === message.fromAgentId && t.column !== "done");
      if (task) {
        reportingTaskTitle = task.title;
        reportingTaskId = task.id;
        this._pendingWorkerReport.set(task.id, message.content);
      }
    }

    // Clean up the finished worker — it already set itself to Done
    if (message.fromAgentId) {
      const worker = this.workers.get(message.fromAgentId);
      if (worker) {
        worker.destroy();
        this.workers.delete(message.fromAgentId);
        console.log(`[TeamLead ${this.id}] Cleaned up finished worker ${message.fromAgentId}`);
      }
    }

    // Detect orphaned tasks (in_progress but assigned to dead workers)
    const orphans = this.getOrphanedTasks();
    const livingWorkers = this.workers.size;

    const board = this.getKanbanBoardState();
    const repoPath = this.projectId ? this.workspace.repoPath(this.projectId) : "";

    // Build the ACTION REQUIRED block for evaluating the worker report
    const actionRequired =
      `\n\n**ACTION REQUIRED — evaluate the worker report above:**\n` +
      `- If the worker SUCCEEDED at its task → \`update_task\` to move it to "done"\n` +
      `- If the worker FAILED → \`update_task\` to move it to "backlog" with \`assigneeAgentId: ""\` so it can be retried`;

    const taskNotice = reportingTaskTitle
      ? `[Task "${reportingTaskTitle}" (${reportingTaskId}) is still in_progress — YOU must evaluate and move it.]\n\n`
      : "";

    // Build the ORPHANED TASKS block if any exist
    const orphanBlock = orphans.length > 0
      ? `\n\n**ORPHANED TASKS** (in_progress but assigned to dead workers — move these to "backlog" with \`assigneeAgentId: ""\`):\n` +
        orphans.map((o) => `  - "${o.title}" (${o.id}) was assigned to ${o.assigneeAgentId.slice(0, 6)}`).join("\n")
      : "";

    let instructions: string;
    if (board.allDone && orphans.length === 0) {
      // All tasks genuinely done and no orphans — final assembly phases
      if (!this.verificationRequested) {
        this.verificationRequested = true;
        instructions =
          `ALL tasks done. Now VERIFY the deliverables work:\n` +
          `1. Create a "Verify build and tests" task using create_task\n` +
          `2. Search the registry for a tester worker (search_registry with capability "testing")\n` +
          `3. Spawn the worker so it runs in the project codebase\n` +
          `4. Give it clear instructions: install dependencies, build the project, start the app, and run tests\n` +
          `5. Wait for the verification results — do NOT report to COO yet\n` +
          `The project repo is at: ${repoPath}`;
      } else if (!this.deploymentRequested) {
        this.deploymentRequested = true;
        instructions =
          `ALL tasks done and verification passed. Now DEPLOY the application:\n` +
          `1. Create a "Deploy application" task using create_task\n` +
          `2. Search the registry for a coder worker (search_registry with capability "code")\n` +
          `3. Spawn the worker so it runs in the project codebase\n` +
          `4. Give it instructions to:\n` +
          `   - Start the application as a persistent background process (use nohup and & so it survives after the worker exits)\n` +
          `   - Wait a few seconds, then verify the app is accessible (curl/wget the health endpoint or main URL)\n` +
          `   - Report back what URL/port the app is running on\n` +
          `5. Wait for the deployment results — do NOT report to COO yet\n` +
          `The project repo is at: ${repoPath}`;
      } else {
        instructions =
          `ALL tasks done, verification passed, and deployment complete.\n` +
          `Review the deployment results in the worker report above.\n` +
          `If the app is running: report success to the COO using report_to_coo — include what was built, verification results, deployment URL/port, and workspace path: ${repoPath}\n` +
          `If deployment failed: create fix tasks, spawn workers to address the issues, then re-deploy`;
      }
    } else if (livingWorkers > 0 && !board.hasUnblockedBacklog && orphans.length === 0) {
      // Workers still running, nothing spawnable — evaluate the report and return.
      // Use a single think() (NOT thinkWithContinuation) to prevent the LLM from
      // looping while it "waits" for workers that report via the message bus.
      const blockedNote = board.hasBacklog && !board.hasUnblockedBacklog
        ? ` (${board.backlogCount} backlog task(s) are BLOCKED — they will become available when their blockers complete)`
        : "";
      const waitInstructions =
        `Evaluate the worker report and move the task accordingly (see ACTION REQUIRED below).` +
        `\nAfter updating the task, STOP IMMEDIATELY. Do not call any other tools. ` +
        `${livingWorkers} worker(s) are still in progress — you will be notified when they finish.${blockedNote}` +
        actionRequired;

      const waitSummary =
        `[Worker ${message.fromAgentId} report]: ${message.content}\n\n` +
        taskNotice +
        `[KANBAN BOARD]\n${board.summary}\n[/KANBAN BOARD]\n\n` +
        waitInstructions;

      const { text } = await this.think(
        waitSummary,
        (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
        (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
        (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
      );

      // Safety net: if the LLM didn't move the task, force-move it
      if (reportingTaskId) {
        this.ensureTaskMoved(reportingTaskId, message.content);
      }

      if (this.parentId && text.trim()) {
        this.sendMessage(this.parentId, MessageType.Report, text);
      }
      return;
    } else if (livingWorkers > 0) {
      // Workers running but there are orphans or backlog to handle
      instructions =
        `Evaluate the worker report and move the task accordingly (see ACTION REQUIRED below).` +
        `\nThen handle any orphaned/backlog tasks below. ${livingWorkers} worker(s) are still in progress — ` +
        `after handling the items below, stop and wait for worker reports. Do NOT spawn workers for [BLOCKED] tasks.` +
        actionRequired + orphanBlock;
    } else if (board.hasUnblockedBacklog || orphans.length > 0) {
      instructions =
        `Evaluate the worker report and move the task accordingly (see ACTION REQUIRED below).` +
        `\nThen spawn workers for any unblocked backlog tasks. Do NOT spawn workers for [BLOCKED] tasks — they will become available when their blockers complete. ` +
        `If a task was previously attempted and failed, its description will contain error details — ` +
        `analyze the failure and include specific fix instructions in the new worker's directive.` +
        actionRequired + orphanBlock;
    } else {
      instructions =
        `Evaluate the worker report and proceed.` +
        actionRequired + orphanBlock;
    }

    const summary =
      `[Worker ${message.fromAgentId} report]: ${message.content}\n\n` +
      taskNotice +
      `[KANBAN BOARD]\n${board.summary}\n[/KANBAN BOARD]\n\n` +
      instructions;

    const { text } = await this.thinkWithContinuation(
      summary,
      (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
      (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
      (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
    );

    // Safety net: if the LLM didn't move the task, force-move it
    if (reportingTaskId) {
      this.ensureTaskMoved(reportingTaskId, message.content);
    }

    // Relay significant updates to COO
    if (this.parentId && text.trim()) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }
  }

  private async handleStatusRequest(message: BusMessage) {
    const workerStatuses: string[] = [];

    // Query each worker for its status (5s timeout per worker)
    const workerEntries = Array.from(this.workers.entries());
    const results = await Promise.all(
      workerEntries.map(async ([id, _worker]) => {
        const reply = await this.bus.request(
          {
            fromAgentId: this.id,
            toAgentId: id,
            type: MessageType.StatusRequest,
            content: "status",
            projectId: this.projectId ?? undefined,
          },
          5_000,
        );
        return reply ? reply.content : `Worker ${id}: no response (may be busy)`;
      }),
    );

    workerStatuses.push(...results);

    const summary = [
      this.getStatusSummary(),
      `Workers (${this.workers.size}):`,
      ...workerStatuses.map((s) => `  - ${s}`),
    ].join("\n");

    this.sendMessage(
      message.fromAgentId,
      MessageType.StatusResponse,
      summary,
      undefined,
      undefined,
      message.correlationId,
    );
  }

  /** Get a snapshot of the kanban board state for continuation decisions */
  private getKanbanBoardState(): {
    hasBacklog: boolean; backlogCount: number;
    hasUnblockedBacklog: boolean; unblockedBacklogCount: number;
    hasInProgress: boolean; inProgressCount: number;
    allDone: boolean; doneCount: number;
    summary: string;
  } {
    if (!this.projectId) {
      return { hasBacklog: false, backlogCount: 0, hasUnblockedBacklog: false, unblockedBacklogCount: 0, hasInProgress: false, inProgressCount: 0, allDone: false, doneCount: 0, summary: "No project context." };
    }

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    if (tasks.length === 0) {
      return { hasBacklog: false, backlogCount: 0, hasUnblockedBacklog: false, unblockedBacklogCount: 0, hasInProgress: false, inProgressCount: 0, allDone: false, doneCount: 0, summary: "No tasks." };
    }

    const byColumn: Record<string, typeof tasks> = { backlog: [], in_progress: [], done: [] };
    for (const t of tasks) {
      (byColumn[t.column] ?? []).push(t);
    }

    const lines: string[] = [];
    for (const [col, colTasks] of Object.entries(byColumn)) {
      if (colTasks.length === 0) continue;
      lines.push(`${col.replace("_", " ").toUpperCase()} (${colTasks.length}):`);
      for (const t of colTasks.sort((a, b) => a.position - b.position)) {
        const assignee = t.assigneeAgentId ? ` [assigned: ${t.assigneeAgentId.slice(0, 6)}]` : "";
        const blockedBy = (t.blockedBy as string[]) ?? [];
        const blocked = col === "backlog" && this.isTaskBlocked(blockedBy);
        const blockedTag = blocked ? ` [BLOCKED by: ${blockedBy.join(", ")}]` : "";
        lines.push(`  - ${t.title} (${t.id})${assignee}${blockedTag}`);
        // Include descriptions for backlog tasks so the TL can see failure context from previous attempts
        if (col === "backlog" && t.description && t.description.includes("PREVIOUS ATTEMPT FAILED")) {
          lines.push(`    ${t.description.slice(t.description.lastIndexOf("--- PREVIOUS ATTEMPT FAILED ---")).slice(0, 300)}`);
        }
      }
    }

    const backlogCount = byColumn.backlog.length;
    const unblockedBacklogCount = byColumn.backlog.filter(
      (t) => !this.isTaskBlocked((t.blockedBy as string[]) ?? []),
    ).length;
    const inProgressCount = byColumn.in_progress.length;
    const doneCount = byColumn.done.length;
    const allDone = tasks.length > 0 && backlogCount === 0 && inProgressCount === 0;
    return {
      hasBacklog: backlogCount > 0,
      backlogCount,
      hasUnblockedBacklog: unblockedBacklogCount > 0,
      unblockedBacklogCount,
      hasInProgress: inProgressCount > 0,
      inProgressCount,
      allDone,
      doneCount,
      summary: lines.join("\n"),
    };
  }

  /** Wrap think() with a continuation loop that checks for remaining backlog tasks */
  private async thinkWithContinuation(
    initialMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined }> {
    // Snapshot board state before first think() for stale-state detection
    let prevBoard = this.getKanbanBoardState();

    let result = await this.think(initialMessage, onToken, onReasoning, onReasoningEnd);

    for (let i = 0; i < MAX_CONTINUATION_CYCLES; i++) {
      if (!result.hadToolCalls) break;

      const board = this.getKanbanBoardState();

      // Stale-state detection: if nothing changed since last cycle, stop looping
      if (
        board.backlogCount === prevBoard.backlogCount &&
        board.inProgressCount === prevBoard.inProgressCount &&
        board.doneCount === prevBoard.doneCount
      ) {
        console.warn(`[TeamLead ${this.id}] Stale state detected — board unchanged after cycle. Breaking continuation loop.`);
        break;
      }

      // Continue only if there's unblocked backlog work
      if (!board.hasUnblockedBacklog) break;

      const prompt =
        `[CONTINUATION] ${board.unblockedBacklogCount} unblocked task(s) remain in backlog:\n${board.summary}\n\n` +
        `Spawn workers for unblocked backlog tasks. Do NOT spawn workers for [BLOCKED] tasks — they will become available when their blockers complete. ` +
        `If a task description contains a "PREVIOUS ATTEMPT FAILED" section, READ IT CAREFULLY — ` +
        `analyze what went wrong and include specific fix instructions in the worker directive ` +
        `(e.g. "run npm install before npm run dev", "use port 4000 instead of 3000").`;

      console.log(`[TeamLead ${this.id}] Continuation cycle ${i + 1}/${MAX_CONTINUATION_CYCLES} — ${board.backlogCount} backlog tasks remain`);

      // Update snapshot for next iteration
      prevBoard = board;

      result = await this.think(
        prompt,
        onToken,
        onReasoning,
        onReasoningEnd,
      );
    }

    return { text: result.text, thinking: result.thinking };
  }

  /** Reset per-cycle tool call counters before each LLM invocation */
  protected override async think(
    userMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean }> {
    this._toolCallCounts.clear();
    return super.think(userMessage, onToken, onReasoning, onReasoningEnd);
  }

  override getStatusSummary(): string {
    return `TeamLead ${this.id} [${this.status}] — ${this.workers.size} worker(s)`;
  }

  protected getTools(): Record<string, unknown> {
    return {
      search_registry: tool({
        description:
          "Search the agent registry for workers with specific capabilities.",
        parameters: z.object({
          capability: z
            .string()
            .describe(
              "The capability to search for (e.g., 'code', 'research', 'testing')",
            ),
        }),
        execute: async ({ capability }) => {
          return this.searchRegistry(capability);
        },
      }),
      spawn_worker: tool({
        description:
          "Spawn a worker agent from a registry template and assign it a task. Always pass taskId to auto-assign the kanban task.",
        parameters: z.object({
          registryEntryId: z
            .string()
            .describe("The ID of the registry entry to use as a template"),
          task: z
            .string()
            .describe("The specific task to assign to the worker"),
          taskId: z
            .string()
            .optional()
            .describe("The kanban task ID to auto-assign to this worker (moves task to in_progress)"),
        }),
        execute: async ({ registryEntryId, task, taskId }) => {
          return this.spawnWorker(registryEntryId, task, taskId);
        },
      }),
      web_search: tool({
        description:
          "Search the web for information. Returns relevant results for the query.",
        parameters: z.object({
          query: z.string().describe("The search query"),
          maxResults: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Maximum number of results to return (default 5, max 20)"),
        }),
        execute: async ({ query, maxResults }) => {
          const provider = getConfiguredSearchProvider();
          if (!provider) {
            return "No search provider configured. Ask the COO to set up a search provider.";
          }
          try {
            const response = await provider.search(query, maxResults ?? 5);
            if (response.results.length === 0) {
              return `No results found for "${query}".`;
            }
            return response.results
              .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n");
          } catch (err) {
            return `Search error: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      report_to_coo: tool({
        description: "Send a progress report or result to the COO.",
        parameters: z.object({
          content: z
            .string()
            .describe("The report content to send to the COO"),
        }),
        execute: async ({ content }) => {
          if (this.parentId) {
            this.sendMessage(this.parentId, MessageType.Report, content);
          }
          return "Report sent to COO.";
        },
      }),
      create_task: tool({
        description:
          "Create a kanban task card for this project. Use this to decompose directives into trackable work items before spawning workers. Use blockedBy to declare dependencies on other tasks.",
        parameters: z.object({
          title: z.string().describe("Short task title"),
          description: z.string().optional().describe("Detailed task description"),
          column: z.enum(["backlog", "in_progress", "done"]).optional().describe("Column to place the task in (default: backlog)"),
          labels: z.array(z.string()).optional().describe("Labels/tags for the task"),
          blockedBy: z.array(z.string()).optional().describe("Task IDs that must complete before this task can start"),
        }),
        execute: async ({ title, description, column, labels, blockedBy }) => {
          return this.createKanbanTask(title, description, column, labels, blockedBy);
        },
      }),
      update_task: tool({
        description:
          "Update a kanban task card. Move tasks between columns, assign agents, or update details.",
        parameters: z.object({
          taskId: z.string().describe("The task ID to update"),
          column: z.enum(["backlog", "in_progress", "done"]).optional().describe("Move task to this column"),
          assigneeAgentId: z.string().optional().describe("Agent ID to assign the task to"),
          description: z.string().optional().describe("Updated description"),
          title: z.string().optional().describe("Updated title"),
          blockedBy: z.array(z.string()).optional().describe("Task IDs that must complete before this task can start"),
        }),
        execute: async ({ taskId, column, assigneeAgentId, description, title, blockedBy }) => {
          return this.updateKanbanTask(taskId, { column, assigneeAgentId, description, title, blockedBy });
        },
      }),
      list_tasks: tool({
        description: "List all kanban tasks for this project. Only call once — repeated calls return the same data.",
        parameters: z.object({}),
        execute: async () => {
          const count = (this._toolCallCounts.get("list_tasks") ?? 0) + 1;
          this._toolCallCounts.set("list_tasks", count);
          if (count > 1) {
            return "REFUSED: You already called list_tasks. The board has not changed. STOP calling tools and return your response now.";
          }
          const result = this.listKanbanTasks();
          const board = this.getKanbanBoardState();
          if (board.hasInProgress && !board.hasBacklog && !board.allDone) {
            return result + "\n\nALL TASKS ASSIGNED. Workers are in progress. STOP — do NOT call any more tools. Return immediately and wait for worker reports via the message bus.";
          }
          return result;
        },
      }),
    };
  }

  private searchRegistry(capability: string): string {
    const db = getDb();
    const allEntries = db.select().from(schema.registryEntries).all();

    const matches = allEntries.filter((entry) => {
      // Only return worker-role entries (not COO or Team Lead)
      if (entry.role !== "worker") return false;
      const caps = entry.capabilities as string[];
      return caps.some((c) =>
        c.toLowerCase().includes(capability.toLowerCase()),
      );
    });

    if (matches.length === 0) {
      return `No agents found with capability "${capability}".`;
    }

    return matches
      .map(
        (e) =>
          `- ${e.name} (${e.id}): ${e.description} [capabilities: ${(e.capabilities as string[]).join(", ")}]`,
      )
      .join("\n");
  }

  private async spawnWorker(
    registryEntryId: string,
    task: string,
    taskId?: string,
  ): Promise<string> {
    try {
      const db = getDb();
      const entry = db
        .select()
        .from(schema.registryEntries)
        .where(eq(schema.registryEntries.id, registryEntryId))
        .get();

      if (!entry) {
        return `Registry entry ${registryEntryId} not found.`;
      }

      const entryTools = (entry.tools as string[]) ?? [];
      const workerId = nanoid();
      let workspacePath: string | null = null;

      if (this.projectId) {
        // All workers with a project get the repo path
        workspacePath = this.workspace.repoPath(this.projectId);
      }

      console.log(`[TeamLead ${this.id}] Spawning worker ${workerId} from ${entry.name} (workspace=${workspacePath})`);

      const worker = new Worker({
        id: workerId,
        bus: this.bus,
        projectId: this.projectId,
        parentId: this.id,
        registryEntryId: entry.id,
        modelPackId: (entry as any).modelPackId ?? getRandomModelPackId(),
        gearConfig: (entry as any).gearConfig ? JSON.parse((entry as any).gearConfig) : null,
        model:
          getConfig("worker_model") ??
          getConfig("coo_model") ??
          entry.defaultModel,
        provider:
          getConfig("worker_provider") ??
          getConfig("coo_provider") ??
          entry.defaultProvider,
        systemPrompt: entry.systemPrompt + buildEnvironmentContext(entryTools) +
          (workspacePath
            ? `\n\n## Your Workspace\nYour workspace directory is: \`${workspacePath}\`\n` +
              `All file paths should be relative to this directory (e.g. \`src/main.go\`, not \`/workspace/src/main.go\`).\n` +
              `Do NOT write to /workspace, /usr, /etc, /opt, /var, or any other location outside your workspace.`
            : ""),
        workspacePath,
        toolNames: entryTools,
        onStatusChange: this.onStatusChange,
        onAgentStream: this.onAgentStream,
        onAgentThinking: this.onAgentThinking,
        onAgentThinkingEnd: this.onAgentThinkingEnd,
        onAgentToolCall: this.onAgentToolCall,
      });

      this.workers.set(worker.id, worker);

      if (this.onAgentSpawned) {
        this.onAgentSpawned(worker);
      }

      // Auto-assign kanban task if taskId provided
      if (taskId) {
        const assigned = this.autoAssignTask(taskId, worker.id);
        if (!assigned) {
          // Task is blocked — clean up the worker and abort
          worker.destroy();
          this.workers.delete(worker.id);
          console.warn(`[TeamLead ${this.id}] Aborted spawn for blocked task ${taskId}`);
          return `BLOCKED: Task ${taskId} cannot start — it depends on tasks that are not yet done. Wait for blockers to complete first.`;
        }
      }

      // Send the task to the worker
      this.sendMessage(worker.id, MessageType.Directive, task, {
        registryEntryName: entry.name,
      });

      const assignedMsg = taskId ? ` Task ${taskId} moved to in_progress.` : "";
      console.log(`[TeamLead ${this.id}] Worker ${workerId} spawned and directive sent`);
      return `Spawned ${entry.name} worker (${worker.id}) and assigned task.${assignedMsg}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TeamLead ${this.id}] Failed to spawn worker: ${errMsg}`, err);
      return `Error spawning worker from ${registryEntryId}: ${errMsg}`;
    }
  }

  /** Find in_progress tasks whose assigneeAgentId is not in this.workers (i.e. the worker is dead). Read-only — does not mutate state. */
  private getOrphanedTasks(): Array<{ id: string; title: string; assigneeAgentId: string }> {
    if (!this.projectId) return [];

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    return tasks
      .filter(
        (t) =>
          t.column === "in_progress" &&
          t.assigneeAgentId &&
          !this.workers.has(t.assigneeAgentId),
      )
      .map((t) => ({ id: t.id, title: t.title, assigneeAgentId: t.assigneeAgentId! }));
  }

  /** Check if a task is blocked — returns true if any blocker task is not yet "done" (missing/deleted IDs resolve automatically) */
  private isTaskBlocked(blockedBy: string[]): boolean {
    if (!blockedBy || blockedBy.length === 0) return false;
    const db = getDb();
    for (const blockerId of blockedBy) {
      const blocker = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, blockerId))
        .get();
      // Missing/deleted blockers resolve automatically
      if (blocker && blocker.column !== "done") return true;
    }
    return false;
  }

  /** Auto-assign a kanban task to a worker: move to in_progress and set assigneeAgentId. Returns false if blocked. */
  private autoAssignTask(taskId: string, workerId: string): boolean {
    if (!this.projectId) return false;

    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (!task) {
      console.warn(`[TeamLead ${this.id}] autoAssignTask: task ${taskId} not found`);
      return false;
    }

    // Programmatic enforcement: refuse if task is blocked
    const blockedBy = (task.blockedBy as string[]) ?? [];
    if (this.isTaskBlocked(blockedBy)) {
      console.warn(
        `[TeamLead ${this.id}] autoAssignTask: task "${task.title}" (${taskId}) is BLOCKED by [${blockedBy.join(", ")}] — refusing assignment`,
      );
      return false;
    }

    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({ column: "in_progress", assigneeAgentId: workerId, updatedAt: now })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (updated) {
      this.onKanbanChange?.("updated", updated as unknown as KanbanTask);
    }

    console.log(`[TeamLead ${this.id}] Auto-assigned task "${task.title}" (${taskId}) to worker ${workerId}`);
    return true;
  }

  private createKanbanTask(
    title: string,
    description?: string,
    column?: string,
    labels?: string[],
    blockedBy?: string[],
  ): string {
    if (!this.projectId) return "No project context.";

    const db = getDb();
    const taskId = nanoid();
    const now = new Date().toISOString();
    const col = (column ?? "backlog") as "backlog" | "in_progress" | "done";

    // Get max position in column
    const existing = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();
    const colTasks = existing.filter((t) => t.column === col);
    const maxPos = colTasks.reduce((max, t) => Math.max(max, t.position), -1);

    const task = {
      id: taskId,
      projectId: this.projectId,
      title,
      description: description ?? "",
      column: col,
      position: maxPos + 1,
      assigneeAgentId: null,
      createdBy: this.id,
      labels: labels ?? [],
      blockedBy: blockedBy ?? [],
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.kanbanTasks).values(task).run();

    this.onKanbanChange?.("created", task as unknown as KanbanTask);
    const blockedInfo = blockedBy?.length ? ` (blocked by: ${blockedBy.join(", ")})` : "";
    return `Task "${title}" created (${taskId}) in ${col}.${blockedInfo}`;
  }

  private updateKanbanTask(
    taskId: string,
    updates: { column?: string; assigneeAgentId?: string; description?: string; title?: string; blockedBy?: string[]; completionReport?: string },
  ): string {
    const db = getDb();
    const existing = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (!existing) return `Task ${taskId} not found.`;

    const setValues: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.column) setValues.column = updates.column;
    if (updates.assigneeAgentId !== undefined) setValues.assigneeAgentId = updates.assigneeAgentId;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.blockedBy !== undefined) setValues.blockedBy = updates.blockedBy;

    // Attach completion report: explicit value takes priority, otherwise use pending worker report
    if (updates.completionReport !== undefined) {
      setValues.completionReport = updates.completionReport;
    } else if (updates.column === "done") {
      const pending = this._pendingWorkerReport.get(taskId);
      if (pending) {
        setValues.completionReport = pending;
        this._pendingWorkerReport.delete(taskId);
      }
    }

    db.update(schema.kanbanTasks)
      .set(setValues)
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (updated) {
      this.onKanbanChange?.("updated", updated as unknown as KanbanTask);
    }

    // When a task moves to done, check for newly unblocked tasks
    if (updates.column === "done") {
      this.checkUnblockedTasks(taskId);
    }

    return `Task "${existing.title}" updated.`;
  }

  /** Log which tasks become unblocked when a task completes. No auto-spawning — the continuation loop picks them up. */
  private checkUnblockedTasks(completedTaskId: string): void {
    if (!this.projectId) return;

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    for (const task of tasks) {
      const blockedBy = (task.blockedBy as string[]) ?? [];
      if (blockedBy.includes(completedTaskId) && task.column === "backlog") {
        if (!this.isTaskBlocked(blockedBy)) {
          console.log(
            `[TeamLead ${this.id}] Task "${task.title}" (${task.id}) is now UNBLOCKED after completion of ${completedTaskId}`,
          );
        }
      }
    }
  }

  private listKanbanTasks(): string {
    if (!this.projectId) return "No project context.";

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    if (tasks.length === 0) return "No tasks in this project.";

    const byColumn: Record<string, typeof tasks> = { backlog: [], in_progress: [], done: [] };
    for (const t of tasks) {
      (byColumn[t.column] ?? []).push(t);
    }

    const lines: string[] = [];
    for (const [col, colTasks] of Object.entries(byColumn)) {
      if (colTasks.length === 0) continue;
      lines.push(`**${col.replace("_", " ").toUpperCase()}** (${colTasks.length}):`);
      for (const t of colTasks.sort((a, b) => a.position - b.position)) {
        const assignee = t.assigneeAgentId ? ` [${t.assigneeAgentId.slice(0, 6)}]` : "";
        const blockedBy = (t.blockedBy as string[]) ?? [];
        const blocked = col === "backlog" && this.isTaskBlocked(blockedBy);
        const blockedTag = blocked ? ` [BLOCKED by: ${blockedBy.join(", ")}]` : "";
        lines.push(`  - ${t.title} (${t.id})${assignee}${blockedTag}`);
      }
    }
    return lines.join("\n");
  }

  getWorkers(): Map<string, Worker> {
    return this.workers;
  }

  /** Clean up all workers on project deletion */
  override destroy(): void {
    // Destroy all active workers
    for (const [id, worker] of this.workers) {
      try {
        worker.destroy();
      } catch (err) {
        console.warn(`[TeamLead ${this.id}] Failed to destroy worker ${id}:`, err);
      }
    }
    this.workers.clear();

    super.destroy();
  }
}
