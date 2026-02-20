import { nanoid } from "nanoid";
import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
  type KanbanTask,
} from "@otterbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { Worker, CODING_AGENT_REGISTRY_IDS } from "./worker.js";

/** All coding agent IDs including the fallback builtin-coder */
const CODING_AGENT_IDS = CODING_AGENT_REGISTRY_IDS;
import { getDb, schema } from "../db/index.js";
import { Registry } from "../registry/registry.js";
import { SkillService } from "../skills/skill-service.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq } from "drizzle-orm";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { execSync } from "node:child_process";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { isDesktopEnabled } from "../desktop/desktop.js";
import { TEAM_LEAD_PROMPT } from "./prompts/team-lead.js";
import { getRandomModelPackId } from "../models3d/model-packs.js";
import { debug } from "../utils/debug.js";

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
      `**Port ${reservedPort} is reserved for the Otterbot server and MUST NOT be used by your applications.** ` +
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
      `## Pre-installed Tools\n` +
      `The following are already installed system-wide — do NOT try to install them:\n` +
      `- **Node.js** (v22), **npm**, **pnpm** (via corepack)\n` +
      `- **Go** (${process.env.GOLANG_VERSION ?? "1.24"})\n` +
      `- **Rust** (stable, via rustup)\n` +
      `- **Python 3** with pip and venv\n` +
      `- **Java** (OpenJDK headless)\n` +
      `- **Ruby**\n` +
      `- **git**, **gh** (GitHub CLI)\n` +
      `- **Playwright** with Chromium — already installed, do NOT run \`npx playwright install\` or install browsers\n` +
      `- **Puppeteer** — already installed with shared Chromium, do NOT reinstall\n` +
      `- **SQLite 3**\n` +
      `- **build-essential**, **pkg-config**, **curl**\n` +
      `- **ss** (iproute2), **netstat** (net-tools)`,
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
  onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;
}

const MAX_CONTINUATION_CYCLES = 5;
const MAX_TASK_RETRIES = 3;

export class TeamLead extends BaseAgent {
  private workers: Map<string, Worker> = new Map();
  private workspace: WorkspaceManager;
  private verificationRequested = false;
  private deploymentRequested = false;
  /** Per-think-cycle call counts — prevents tools from being called repeatedly within a single streamText run */
  private _toolCallCounts = new Map<string, number>();
  private _pendingWorkerReport = new Map<string, string>();
  private allowedToolNames: Set<string>;
  private onAgentSpawned?: (agent: BaseAgent) => void;
  private onKanbanChange?: (event: "created" | "updated" | "deleted", task: KanbanTask) => void;
  private _onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  private _onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  private _onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;

  constructor(deps: TeamLeadDependencies) {
    const registry = new Registry();
    const tlEntry = registry.get("builtin-team-lead");
    // Build system prompt with optional GitHub context
    let systemPrompt = tlEntry?.systemPrompt ?? TEAM_LEAD_PROMPT;

    // Inject GitHub context if this project is linked to a repo
    const ghRepo = getConfig(`project:${deps.projectId}:github:repo`);
    const ghBranch = getConfig(`project:${deps.projectId}:github:branch`);
    const ghRulesRaw = getConfig(`project:${deps.projectId}:github:rules`);
    if (ghRepo) {
      const sections: string[] = [
        `\n\n## GitHub Integration`,
        `Repository: ${ghRepo}`,
        `Target branch: ${ghBranch ?? "main"}`,
        `**PR Workflow:** Workers must create feature branches from \`${ghBranch ?? "main"}\`, commit, push, and open a PR targeting \`${ghBranch ?? "main"}\`.`,
        `Use conventional commits and reference issue numbers.`,
      ];
      if (ghRulesRaw) {
        try {
          const rules = JSON.parse(ghRulesRaw) as string[];
          if (rules.length > 0) {
            sections.push(`\n**Project Rules:**`);
            sections.push(...rules.map((r) => `- ${r}`));
          }
        } catch { /* ignore */ }
      }
      systemPrompt += sections.join("\n");
    }

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
      systemPrompt,
      onStatusChange: deps.onStatusChange,
      onAgentStream: deps.onAgentStream,
      onAgentThinking: deps.onAgentThinking,
      onAgentThinkingEnd: deps.onAgentThinkingEnd,
      onAgentToolCall: deps.onAgentToolCall,
    };
    super(options, deps.bus);

    // Limit tool call rounds to prevent runaway loops with less capable models
    this.llmConfig.maxSteps = 10;

    // Derive allowed tools from assigned skills
    const skillService = new SkillService();
    const tlSkills = skillService.getForAgent("builtin-team-lead");
    this.allowedToolNames = new Set(tlSkills.flatMap((s) => s.meta.tools));

    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
    this.onKanbanChange = deps.onKanbanChange;
    this._onCodingAgentEvent = deps.onCodingAgentEvent;
    this._onCodingAgentAwaitingInput = deps.onCodingAgentAwaitingInput;
    this._onCodingAgentPermissionRequest = deps.onCodingAgentPermissionRequest;

    // Restore persisted flags from previous runs
    this.verificationRequested = this.loadFlag("verification");
    this.deploymentRequested = this.loadFlag("deployment");
  }

  /** Persist a flag to the config KV table so it survives restarts */
  private persistFlag(flag: "verification" | "deployment", value: boolean): void {
    const key = `project:${this.projectId}:${flag}_requested`;
    if (value) {
      setConfig(key, "true");
    } else {
      deleteConfig(key);
    }
  }

  /** Load a persisted flag from the config KV table */
  private loadFlag(flag: "verification" | "deployment"): boolean {
    if (!this.projectId) return false;
    const key = `project:${this.projectId}:${flag}_requested`;
    return getConfig(key) === "true";
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
    this.persistFlag("verification", false);
    this.persistFlag("deployment", false);
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
    if (!report.trim()) return true;
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
  private ensureTaskMoved(taskId: string, workerReport: string): boolean {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (!task || task.column !== "in_progress") return false; // LLM already moved it

    const failed = this.isFailureReport(workerReport);
    const assignee = failed ? "" : task.assigneeAgentId;

    // Preview retry count to decide target column (updateKanbanTask handles the actual increment)
    const currentRetries = (task as any).retryCount ?? 0;
    const nextRetryCount = failed ? currentRetries + 1 : currentRetries;
    const retriesExhausted = failed && nextRetryCount >= MAX_TASK_RETRIES;
    // Always target "backlog" for failures — updateKanbanTask will force to "done" if retries exhausted
    const targetColumn = failed ? "backlog" : "done";

    console.warn(
      `[TeamLead ${this.id}] Safety net: LLM did not move task "${task.title}" (${taskId}). ` +
      `Force-moving to "${targetColumn}" (report ${failed ? "indicates failure" : "looks successful"}` +
      `${failed ? `, retry ${nextRetryCount}/${MAX_TASK_RETRIES}` : ""}).`,
    );

    // Build updates — updateKanbanTask handles retry counting for backlog transitions
    const updates: { column: string; assigneeAgentId: string; description?: string; completionReport?: string } = {
      column: targetColumn,
      assigneeAgentId: assignee ?? "",
    };

    if (!failed) {
      updates.completionReport = workerReport;
    }

    if (failed && !retriesExhausted) {
      const snippet = workerReport.length > 500
        ? workerReport.slice(-500)
        : workerReport;
      const existing = task.description ?? "";
      updates.description = existing +
        `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${snippet}\n` +
        `--- Analyze the error above and fix the root cause in your next attempt. ---`;
    }

    this.updateKanbanTask(taskId, updates);

    // Re-read the task to check if updateKanbanTask forced it to "done" (retries exhausted)
    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (updated?.column === "done") {
      this.checkUnblockedTasks(taskId);
    }

    return true; // We did force-move
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

    debug("team-lead", `handleWorkerReport from=${message.fromAgentId} taskId=${reportingTaskId} reportLen=${message.content.length} report="${message.content.slice(0, 200)}"`);
    debug("team-lead", `isFailureReport=${reportingTaskId ? this.isFailureReport(message.content) : "N/A"}`);

    // Clean up the finished worker — it already set itself to Done
    if (message.fromAgentId) {
      const worker = this.workers.get(message.fromAgentId);
      if (worker) {
        worker.destroy();
        this.workers.delete(message.fromAgentId);
        console.log(`[TeamLead ${this.id}] Cleaned up finished worker ${message.fromAgentId}`);
      }
    }

    // Programmatically clean up orphaned tasks (in_progress but assigned to dead workers)
    // Don't rely on the LLM — it consistently fails to handle orphans
    for (const orphan of this.getOrphanedTasks()) {
      console.log(
        `[TeamLead ${this.id}] Auto-cleaning orphaned task "${orphan.title}" (${orphan.id}) — assigned to dead worker ${orphan.assigneeAgentId.slice(0, 6)}`,
      );
      this.updateKanbanTask(orphan.id, { column: "backlog", assigneeAgentId: "" });
    }

    // Re-check orphans after cleanup (should be 0 now)
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
        this.persistFlag("verification", true);
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
        this.persistFlag("deployment", true);
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
      let forceMoved = false;
      if (reportingTaskId) {
        forceMoved = this.ensureTaskMoved(reportingTaskId, message.content);
      }

      if (this.parentId && text.trim()) {
        this.sendMessage(this.parentId, MessageType.Report, text);
      }

      // If the safety net force-moved the task, check if there are now unblocked
      // backlog tasks that need workers spawned. The original branch skipped
      // thinkWithContinuation, so we need to trigger it explicitly.
      if (forceMoved) {
        const postBoard = this.getKanbanBoardState();
        if (postBoard.hasUnblockedBacklog) {
          console.log(
            `[TeamLead ${this.id}] Safety net unblocked ${postBoard.unblockedBacklogCount} task(s) — triggering continuation to spawn workers.`,
          );
          const contPrompt =
            `[CONTINUATION] The safety net moved a completed task to "done", unblocking ${postBoard.unblockedBacklogCount} task(s).\n` +
            `[KANBAN BOARD]\n${postBoard.summary}\n[/KANBAN BOARD]\n\n` +
            `Spawn workers for the unblocked backlog tasks. Do NOT spawn workers for [BLOCKED] tasks.`;
          await this.thinkWithContinuation(
            contPrompt,
            (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
            (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
            (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
          );
        }
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
    } else if (board.hasBacklog && !board.hasUnblockedBacklog) {
      // All remaining backlog tasks are blocked, no workers running, not all done.
      // This is a deadlock or the blocked tasks' blockers just completed.
      // Use single think() — there's nothing to spawn.
      instructions =
        `Evaluate the worker report and move the task accordingly (see ACTION REQUIRED below).` +
        `\nAll remaining backlog tasks are BLOCKED — after evaluating the report, STOP. ` +
        `Do NOT call any more tools. Blocked tasks will become available when their blockers complete.` +
        actionRequired + orphanBlock;
    } else {
      instructions =
        `Evaluate the worker report and move the task accordingly (see ACTION REQUIRED below).` +
        `\nAfter evaluating the report, STOP. Do NOT call any more tools.` +
        actionRequired + orphanBlock;
    }

    const summary =
      `[Worker ${message.fromAgentId} report]: ${message.content}\n\n` +
      taskNotice +
      `[KANBAN BOARD]\n${board.summary}\n[/KANBAN BOARD]\n\n` +
      instructions;

    // Use a single think() when there's nothing to spawn — thinkWithContinuation
    // would just loop the LLM pointlessly. This covers:
    //  - all tasks done
    //  - all backlog tasks are blocked (nothing to spawn)
    //  - no backlog, no orphans, no workers (edge case)
    const useSimpleThink = orphans.length === 0 && (
      board.allDone ||
      !board.hasUnblockedBacklog
    );

    console.log(
      `[TeamLead ${this.id}] handleWorkerReport: allDone=${board.allDone} backlog=${board.backlogCount} unblocked=${board.unblockedBacklogCount} inProgress=${board.inProgressCount} workers=${livingWorkers} orphans=${orphans.length} → ${useSimpleThink ? "think()" : "thinkWithContinuation()"}`,
    );

    const { text } = useSimpleThink
      ? await this.think(
          summary,
          (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
          (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
          (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
        )
      : await this.thinkWithContinuation(
          summary,
          (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
          (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
          (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
        );

    // Safety net: if the LLM didn't move the task, force-move it
    let forceMoved = false;
    if (reportingTaskId) {
      forceMoved = this.ensureTaskMoved(reportingTaskId, message.content);
    }

    // Relay significant updates to COO
    if (this.parentId && text.trim()) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }

    // If the safety net force-moved a task after thinkWithContinuation already
    // finished, there may be newly unblocked tasks. Trigger one more continuation.
    if (forceMoved) {
      const postBoard = this.getKanbanBoardState();
      if (postBoard.hasUnblockedBacklog) {
        console.log(
          `[TeamLead ${this.id}] Safety net unblocked ${postBoard.unblockedBacklogCount} task(s) after continuation — spawning workers.`,
        );
        const contPrompt =
          `[CONTINUATION] The safety net moved a completed task to "done", unblocking ${postBoard.unblockedBacklogCount} task(s).\n` +
          `[KANBAN BOARD]\n${postBoard.summary}\n[/KANBAN BOARD]\n\n` +
          `Spawn workers for the unblocked backlog tasks. Do NOT spawn workers for [BLOCKED] tasks.`;
        await this.thinkWithContinuation(
          contPrompt,
          (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
          (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
          (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
        );
      }
    }

    // Auto-spawn fallback: if the LLM failed to spawn workers for unblocked tasks,
    // do it programmatically. Bounded by MAX_TASK_RETRIES (tasks eventually move to
    // "done" as FAILED) and single-coding-worker rule (spawnWorker refuses duplicates).
    await this.autoSpawnUnblockedTasks();
  }

  /**
   * Programmatically spawn workers for unblocked backlog tasks that the LLM missed.
   * Only spawns one coding worker at a time. Non-coding tasks are skipped (rare).
   */
  private async autoSpawnUnblockedTasks(): Promise<void> {
    if (!this.projectId) return;

    const finalBoard = this.getKanbanBoardState();
    if (!finalBoard.hasUnblockedBacklog || this.workers.size > 0) return;

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    const unblockedBacklog = tasks
      .filter(
        (t) =>
          t.column === "backlog" &&
          !this.isTaskBlocked((t.blockedBy as string[]) ?? []),
      )
      .sort((a, b) => a.position - b.position);

    if (unblockedBacklog.length === 0) return;

    // Pick the first unblocked task
    const task = unblockedBacklog[0];

    // Check if task is browser/desktop-related — sandboxed coding agents can't do these
    const taskText = `${task.title} ${task.description ?? ""}`.toLowerCase();
    const isBrowserTask = /\b(browser|chrome|chromium|firefox|launch.*browser|open.*url|browse.*web|headless|puppeteer|playwright|selenium|desktop.*app)\b/.test(taskText);

    // Find the right registry entry — pick the first enabled coding agent
    let registryEntryId = "builtin-coder";
    if (isBrowserTask) {
      registryEntryId = "builtin-browser-agent";
    } else if (getConfig("opencode:enabled") === "true") {
      registryEntryId = "builtin-opencode-coder";
    } else if (getConfig("claude-code:enabled") === "true") {
      registryEntryId = "builtin-claude-code-coder";
    } else if (getConfig("codex:enabled") === "true") {
      registryEntryId = "builtin-codex-coder";
    }

    console.log(
      `[TeamLead ${this.id}] Auto-spawn: LLM failed to spawn worker for "${task.title}" (${task.id}) — spawning ${registryEntryId} programmatically.`,
    );

    const taskDescription = task.description
      ? `${task.title}\n\n${task.description}`
      : task.title;

    const result = await this.spawnWorker(registryEntryId, taskDescription, task.id);
    console.log(`[TeamLead ${this.id}] Auto-spawn result: ${result.slice(0, 200)}`);
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
        const retryCount = (t as any).retryCount ?? 0;
        const retryTag = col === "backlog" && retryCount > 0 ? ` [retry ${retryCount}/${MAX_TASK_RETRIES}]` : "";
        lines.push(`  - ${t.title} (${t.id})${assignee}${blockedTag}${retryTag}`);
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
    let result = await this.think(initialMessage, onToken, onReasoning, onReasoningEnd);

    for (let i = 0; i < MAX_CONTINUATION_CYCLES; i++) {
      if (!result.hadToolCalls) {
        debug("team-lead", `thinkWithContinuation cycle=${i} — no tool calls, breaking`);
        break;
      }

      const board = this.getKanbanBoardState();
      debug("team-lead", `thinkWithContinuation cycle=${i} board: backlog=${board.backlogCount} unblocked=${board.unblockedBacklogCount} inProgress=${board.inProgressCount} done=${board.doneCount} allDone=${board.allDone}`);

      // If everything is done, stop — no point looping when there's nothing to spawn
      if (board.allDone) {
        console.log(`[TeamLead ${this.id}] All tasks done — exiting continuation loop.`);
        debug("team-lead", `thinkWithContinuation cycle=${i} — allDone, breaking`);
        break;
      }

      // Continue only if there's unblocked backlog work
      if (!board.hasUnblockedBacklog) {
        debug("team-lead", `thinkWithContinuation cycle=${i} — no unblocked backlog, breaking`);
        break;
      }

      // If a coding worker is already running, don't continue just for coding tasks
      // that would be refused anyway — this prevents the spam-retry loop
      const hasCodingWorkerRunning = [...this.workers.values()].some(
        (w) => CODING_AGENT_IDS.has(w.registryEntryId!),
      );
      if (hasCodingWorkerRunning && board.hasInProgress) {
        console.log(`[TeamLead ${this.id}] Coding worker running with tasks in progress — waiting for reports.`);
        break;
      }

      const prompt =
        `[CONTINUATION] ${board.unblockedBacklogCount} unblocked task(s) remain in backlog:\n${board.summary}\n\n` +
        `Spawn workers for unblocked backlog tasks. Do NOT spawn workers for [BLOCKED] tasks — they will become available when their blockers complete. ` +
        `If a task description contains a "PREVIOUS ATTEMPT FAILED" section, READ IT CAREFULLY — ` +
        `analyze what went wrong and include specific fix instructions in the worker directive ` +
        `(e.g. "run npm install before npm run dev", "use port 4000 instead of 3000").`;

      console.log(`[TeamLead ${this.id}] Continuation cycle ${i + 1}/${MAX_CONTINUATION_CYCLES} — ${board.backlogCount} backlog tasks remain`);

      // Snapshot board BEFORE think() so we can detect no-progress cycles immediately
      const boardBeforeThink = board;

      result = await this.think(
        prompt,
        onToken,
        onReasoning,
        onReasoningEnd,
      );

      // Zero-lag stale-state detection: if think() didn't change the board, stop
      // immediately instead of waiting for the next cycle to notice
      const boardAfterThink = this.getKanbanBoardState();
      if (
        boardAfterThink.backlogCount === boardBeforeThink.backlogCount &&
        boardAfterThink.inProgressCount === boardBeforeThink.inProgressCount &&
        boardAfterThink.doneCount === boardBeforeThink.doneCount
      ) {
        console.warn(`[TeamLead ${this.id}] No board progress in cycle ${i + 1} — breaking continuation loop.`);
        debug("team-lead", `thinkWithContinuation cycle=${i} — board unchanged after think(), breaking`);
        break;
      }
    }

    return { text: result.text, thinking: result.thinking };
  }

  /** Reset per-cycle tool call counters and prune history before each LLM invocation */
  protected override async think(
    userMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean; isError?: boolean }> {
    this._toolCallCounts.clear();
    this.pruneConversationHistory(40);
    return super.think(userMessage, onToken, onReasoning, onReasoningEnd);
  }

  override getStatusSummary(): string {
    return `TeamLead ${this.id} [${this.status}] — ${this.workers.size} worker(s)`;
  }

  protected getTools(): Record<string, unknown> {
    const allTools: Record<string, unknown> = this.getAllTeamLeadTools();

    // Filter to only the tools declared by assigned skills
    if (this.allowedToolNames.size > 0) {
      const filtered: Record<string, unknown> = {};
      for (const [name, t] of Object.entries(allTools)) {
        if (this.allowedToolNames.has(name)) {
          filtered[name] = t;
        }
      }
      return filtered;
    }

    return allTools;
  }

  /** All possible Team Lead tools — filtered by skills in getTools() */
  private getAllTeamLeadTools(): Record<string, unknown> {
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
          // After a spawn refusal, block all further spawn attempts in this think cycle
          const refusals = this._toolCallCounts.get("spawn_worker_refused") ?? 0;
          if (refusals > 0) {
            this._shouldAbortThink = true;
            return "STOP. Already refused. Wait for current worker to finish.";
          }
          const result = await this.spawnWorker(registryEntryId, task, taskId);
          if (result.startsWith("REFUSED:")) {
            this._toolCallCounts.set("spawn_worker_refused", refusals + 1);
            this._shouldAbortThink = true;
          }
          return result;
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
          blockedBy: z.array(z.string()).optional().describe("Actual task IDs (from create_task results) that must complete before this task can start. Do NOT use symbolic names like 'task-1'."),
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
      delete_task: tool({
        description:
          "Delete a kanban task. Any tasks that had this task in their blockedBy will be automatically unblocked. " +
          "Use this when a task is replaced by a new one, or is no longer needed.",
        parameters: z.object({
          taskId: z.string().describe("The task ID to delete"),
        }),
        execute: async ({ taskId }) => {
          return this.deleteKanbanTask(taskId);
        },
      }),
      list_tasks: tool({
        description: "List all kanban tasks for this project. Only call once per cycle — repeated calls return nothing.",
        parameters: z.object({}),
        execute: async () => {
          const count = (this._toolCallCounts.get("list_tasks") ?? 0) + 1;
          this._toolCallCounts.set("list_tasks", count);
          if (count > 1) {
            return "ALREADY LISTED — do not call again. Proceed with spawning workers.";
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
    const registry = new Registry();
    const allEntries = registry.list();
    // Check which external coding agents are enabled
    const hasExternalCodingAgent =
      getConfig("opencode:enabled") === "true" ||
      getConfig("claude-code:enabled") === "true" ||
      getConfig("codex:enabled") === "true";

    const matches = allEntries.filter((entry) => {
      // Only return worker-role entries (not COO or Team Lead)
      if (entry.role !== "worker") return false;
      // Hide the regular coder when any external coding agent is enabled
      if (hasExternalCodingAgent && entry.id === "builtin-coder") return false;
      // Hide disabled external coding agents
      if (entry.id === "builtin-opencode-coder" && getConfig("opencode:enabled") !== "true") return false;
      if (entry.id === "builtin-claude-code-coder" && getConfig("claude-code:enabled") !== "true") return false;
      if (entry.id === "builtin-codex-coder" && getConfig("codex:enabled") !== "true") return false;
      return entry.capabilities.some((c) =>
        c.toLowerCase().includes(capability.toLowerCase()),
      );
    });

    if (matches.length === 0) {
      return `No agents found with capability "${capability}".`;
    }

    return matches
      .map(
        (e) =>
          `- ${e.name} (${e.id}): ${e.description} [capabilities: ${e.capabilities.join(", ")}]`,
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

      // Derive tools and system prompt content from assigned skills
      const skillService = new SkillService();
      const entrySkills = skillService.getForAgent(entry.id);
      const entryTools = [...new Set(entrySkills.flatMap((s) => s.meta.tools as string[]))];
      const skillPromptContent = entrySkills.map((s) => s.body.trim()).filter(Boolean).join("\n\n");

      // Enforce single-coding-worker rule: only one coding agent
      // can run at a time to prevent file conflicts in the shared workspace
      const isCodingWorker = CODING_AGENT_IDS.has(registryEntryId);
      if (isCodingWorker) {
        for (const [existingId, existingWorker] of this.workers) {
          if (CODING_AGENT_IDS.has(existingWorker.registryEntryId!)) {
            console.warn(
              `[TeamLead ${this.id}] Refused to spawn coding worker — another coding worker (${existingId}) is already running. Use blockedBy to sequence coding tasks.`,
            );
            return `REFUSED: Another coding worker (${existingId}) is already running. Only one coding worker can run at a time to avoid file conflicts. STOP trying to spawn coding workers — you will be notified when the current one finishes. Do NOT call spawn_worker again until you receive a worker report.`;
          }
        }
      }

      const workerId = nanoid();
      let workspacePath: string | null = null;

      if (this.projectId) {
        // All workers with a project get the repo path
        workspacePath = this.workspace.repoPath(this.projectId);
      }

      // Derive human-readable name from kanban task title or task description
      let workerName: string | null = null;
      if (taskId) {
        const kanbanTask = db
          .select({ title: schema.kanbanTasks.title })
          .from(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.id, taskId))
          .get();
        if (kanbanTask?.title) {
          workerName = kanbanTask.title.slice(0, 60);
        }
      }
      if (!workerName) {
        // Fallback: first line of the task string, truncated
        workerName = task.split("\n")[0].slice(0, 60) || null;
      }

      console.log(`[TeamLead ${this.id}] Spawning worker ${workerId} "${workerName}" from ${entry.name} (workspace=${workspacePath})`);

      // Build GitHub context for worker system prompt if project is linked to a repo
      let githubWorkerContext = "";
      if (this.projectId) {
        const wGhRepo = getConfig(`project:${this.projectId}:github:repo`);
        const wGhBranch = getConfig(`project:${this.projectId}:github:branch`);
        const wGhRulesRaw = getConfig(`project:${this.projectId}:github:rules`);
        if (wGhRepo) {
          const parts: string[] = [
            `\n\n## GitHub Workflow`,
            `Repository: ${wGhRepo}`,
            `Create a feature branch from \`${wGhBranch ?? "main"}\`.`,
            `After completing your work, push your branch and create a pull request targeting \`${wGhBranch ?? "main"}\`.`,
            `Use conventional commits and reference issue numbers where applicable.`,
          ];
          if (wGhRulesRaw) {
            try {
              const rules = JSON.parse(wGhRulesRaw) as string[];
              if (rules.length > 0) {
                parts.push(`\n**Project Rules:**`);
                parts.push(...rules.map((r) => `- ${r}`));
              }
            } catch { /* ignore */ }
          }
          githubWorkerContext = parts.join("\n");
        }
      }

      const worker = new Worker({
        id: workerId,
        name: workerName,
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
        systemPrompt: (skillPromptContent || entry.systemPrompt) + buildEnvironmentContext(entryTools) +
          githubWorkerContext +
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
        onCodingAgentEvent: this._onCodingAgentEvent,
        onCodingAgentAwaitingInput: this._onCodingAgentAwaitingInput,
        onCodingAgentPermissionRequest: this._onCodingAgentPermissionRequest,
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

    // Get existing tasks for position and blockedBy validation
    const existing = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    // Validate blockedBy IDs — reject symbolic names like "task-1"
    if (blockedBy && blockedBy.length > 0) {
      const existingIds = new Set(existing.map((t) => t.id));
      const invalid = blockedBy.filter((id) => !existingIds.has(id));
      if (invalid.length > 0) {
        // Build a lookup of existing tasks for the error message
        const taskList = existing.map((t) => `  "${t.title}" → ${t.id}`).join("\n");
        return (
          `ERROR: blockedBy contains invalid task IDs: ${invalid.join(", ")}. ` +
          `You must use the actual task IDs returned by create_task (the string in parentheses), ` +
          `NOT symbolic names like "task-1". Existing tasks:\n${taskList}\n` +
          `Re-create this task with the correct blockedBy IDs.`
        );
      }
    }

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
    return `Created task ID=${taskId} — "${title}" in ${col}.${blockedInfo} Use ID "${taskId}" when referencing this task in blockedBy.`;
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

    // Guard: no-op if already in the target column (prevents redundant updates)
    if (updates.column && updates.column === existing.column && !updates.description && !updates.title && updates.assigneeAgentId === undefined) {
      return `Task "${existing.title}" is already in "${updates.column}" — no change needed.`;
    }

    // Guard: prevent moving tasks backwards out of "done"
    // The LLM sometimes marks a task done then immediately reverts it to backlog in the same cycle.
    // If a task needs to be redone, use delete_task + create_task instead.
    if (updates.column && updates.column !== "done" && existing.column === "done") {
      console.warn(
        `[TeamLead ${this.id}] Blocked update_task: cannot move "${existing.title}" (${taskId}) from "done" back to "${updates.column}". Use delete_task + create_task to redo a completed task.`,
      );
      return `REJECTED: Task "${existing.title}" is already done. You cannot move a completed task back to "${updates.column}". If this task needs to be redone, use delete_task to remove it and create_task to create a new one.`;
    }

    const setValues: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.column) setValues.column = updates.column;
    if (updates.assigneeAgentId !== undefined) setValues.assigneeAgentId = updates.assigneeAgentId;
    if (updates.description !== undefined) setValues.description = updates.description;
    if (updates.title !== undefined) setValues.title = updates.title;
    if (updates.blockedBy !== undefined) setValues.blockedBy = updates.blockedBy;

    // Retry count enforcement: when LLM moves a task from in_progress back to backlog
    if (updates.column === "backlog" && existing.column === "in_progress") {
      const currentRetries = (existing as any).retryCount ?? 0;
      const newRetryCount = currentRetries + 1;
      setValues.retryCount = newRetryCount;

      if (newRetryCount >= MAX_TASK_RETRIES) {
        // Exceeded max retries — force to done with failure report
        setValues.column = "done";
        const snippet = (updates.description ?? existing.description ?? "").slice(-500);
        setValues.completionReport = `FAILED: Exceeded maximum retry attempts (${MAX_TASK_RETRIES}). Last error: ${snippet}`;
        console.warn(
          `[TeamLead ${this.id}] Task "${existing.title}" (${taskId}) exceeded ${MAX_TASK_RETRIES} retries — marking as FAILED.`,
        );
      }
    }

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

  private deleteKanbanTask(taskId: string): string {
    if (!this.projectId) return "No project context.";

    const db = getDb();
    const existing = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (!existing) return `Task ${taskId} not found.`;

    // Delete the task
    db.delete(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    this.onKanbanChange?.("deleted", existing as unknown as KanbanTask);

    // Remove this task from other tasks' blockedBy lists so they become unblocked
    const allTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    let unblockedCount = 0;
    for (const t of allTasks) {
      const blockedBy = (t.blockedBy as string[]) ?? [];
      if (blockedBy.includes(taskId)) {
        const newBlockedBy = blockedBy.filter((id) => id !== taskId);
        db.update(schema.kanbanTasks)
          .set({ blockedBy: newBlockedBy, updatedAt: new Date().toISOString() })
          .where(eq(schema.kanbanTasks.id, t.id))
          .run();

        if (!this.isTaskBlocked(newBlockedBy)) {
          unblockedCount++;
          console.log(`[TeamLead ${this.id}] Task "${t.title}" (${t.id}) unblocked after deletion of ${taskId}`);
        }

        const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, t.id)).get();
        if (updated) {
          this.onKanbanChange?.("updated", updated as unknown as KanbanTask);
        }
      }
    }

    const unblockedMsg = unblockedCount > 0 ? ` ${unblockedCount} task(s) unblocked.` : "";
    return `Task "${existing.title}" deleted.${unblockedMsg}`;
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
