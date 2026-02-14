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
import { GitWorktreeManager } from "../workspace/git-worktree.js";
import { eq } from "drizzle-orm";
import { getConfig } from "../auth/auth.js";
import { execSync } from "node:child_process";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { isDesktopEnabled } from "../desktop/desktop.js";
import { TEAM_LEAD_PROMPT } from "./prompts/team-lead.js";
import { getRandomModelPackId } from "../models3d/model-packs.js";

/** Tools that indicate a worker writes code and should get a worktree */
const CODE_TOOLS = new Set(["file_write", "shell_exec"]);

/** Tool descriptions for environment context injection */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  file_read: "Read files from the workspace",
  file_write: "Create and edit files in the workspace",
  shell_exec: "Execute shell commands in the workspace directory",
  web_search: "Search the web for information",
  web_browse: "Browse web pages with a headless browser (Playwright)",
  install_package: "Install apt or npm packages (persisted across restarts)",
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

  // sudo availability
  if (toolNames.includes("shell_exec")) {
    const sudoMode = process.env.SUDO_MODE ?? "restricted";
    if (sudoMode === "full") {
      sections.push(`## System Access\nsudo is available with full privileges (no password required).`);
    } else {
      sections.push(`## System Access\nsudo is available for: apt-get, npm, tee, gpg, install. Use install_package tool when possible.`);
    }
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
  private gitWorktree: GitWorktreeManager | null = null;
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

    // Initialize git worktree manager for the project
    if (deps.projectId) {
      const repoPath = this.workspace.repoPath(deps.projectId);
      const worktreesDir = this.workspace.worktreesBasePath(deps.projectId);
      this.gitWorktree = new GitWorktreeManager(repoPath, worktreesDir);
    }
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

  private async handleWorkerReport(message: BusMessage) {
    // Auto-mark the worker's kanban task as "done"
    const movedTask = message.fromAgentId
      ? this.markWorkerTaskDone(message.fromAgentId)
      : null;

    // Clean up the finished worker — it already set itself to Done
    if (message.fromAgentId) {
      const worker = this.workers.get(message.fromAgentId);
      if (worker) {
        worker.destroy();
        this.workers.delete(message.fromAgentId);
        console.log(`[TeamLead ${this.id}] Cleaned up finished worker ${message.fromAgentId}`);
      }
    }

    const board = this.getKanbanBoardState();
    const branchInfo = this.gitWorktree ? this.getBranchOverview() : "";

    const repoPath = this.projectId ? this.workspace.repoPath(this.projectId) : "";
    let instructions: string;
    if (board.allDone) {
      instructions =
        `ALL tasks are now complete. Begin FINAL ASSEMBLY:\n` +
        `1. Merge all worker branches in dependency order (foundational first) using merge_worker_branch\n` +
        `2. Report the completed project to the COO using report_to_coo — include the workspace path: ${repoPath}`;
    } else if (board.hasBacklog) {
      instructions = `Backlog tasks remain — spawn workers for them.`;
    } else {
      instructions =
        `Other workers are still in progress. ` +
        `STOP. Do not call any tools. Do not call list_tasks or get_branch_status. ` +
        `Return a brief status update and wait — worker reports arrive automatically via the message bus.`;
    }

    const summary =
      `[Worker ${message.fromAgentId} report]: ${message.content}\n\n` +
      (movedTask ? `[Task "${movedTask}" moved to done automatically.]\n\n` : "") +
      `[KANBAN BOARD]\n${board.summary}\n[/KANBAN BOARD]\n\n` +
      (branchInfo ? `[GIT BRANCHES]\n${branchInfo}\n[/GIT BRANCHES]\n\n` : "") +
      instructions;

    const { text } = await this.thinkWithContinuation(
      summary,
      (token, messageId) => this.onAgentStream?.(this.id, token, messageId),
      (token, messageId) => this.onAgentThinking?.(this.id, token, messageId),
      (messageId) => this.onAgentThinkingEnd?.(this.id, messageId),
    );

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
    hasInProgress: boolean; inProgressCount: number;
    allDone: boolean; doneCount: number;
    summary: string;
  } {
    if (!this.projectId) {
      return { hasBacklog: false, backlogCount: 0, hasInProgress: false, inProgressCount: 0, allDone: false, doneCount: 0, summary: "No project context." };
    }

    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all();

    if (tasks.length === 0) {
      return { hasBacklog: false, backlogCount: 0, hasInProgress: false, inProgressCount: 0, allDone: false, doneCount: 0, summary: "No tasks." };
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
        lines.push(`  - ${t.title} (${t.id})${assignee}`);
      }
    }

    const backlogCount = byColumn.backlog.length;
    const inProgressCount = byColumn.in_progress.length;
    const doneCount = byColumn.done.length;
    const allDone = tasks.length > 0 && backlogCount === 0 && inProgressCount === 0;
    return {
      hasBacklog: backlogCount > 0,
      backlogCount,
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
    let prevWorktreeCount = this.gitWorktree?.hasRepo()
      ? this.gitWorktree.listWorktrees().length
      : 0;

    let result = await this.think(initialMessage, onToken, onReasoning, onReasoningEnd);

    for (let i = 0; i < MAX_CONTINUATION_CYCLES; i++) {
      if (!result.hadToolCalls) break;

      const board = this.getKanbanBoardState();
      const worktreeCount = this.gitWorktree?.hasRepo()
        ? this.gitWorktree.listWorktrees().length
        : 0;

      // Stale-state detection: if nothing changed since last cycle, stop looping
      if (
        board.backlogCount === prevBoard.backlogCount &&
        board.inProgressCount === prevBoard.inProgressCount &&
        board.doneCount === prevBoard.doneCount &&
        worktreeCount === prevWorktreeCount
      ) {
        console.warn(`[TeamLead ${this.id}] Stale state detected — board and worktrees unchanged after cycle. Breaking continuation loop.`);
        break;
      }

      // Continue if there's backlog work OR if all tasks are done but branches need merging
      const hasUnmergedBranches = worktreeCount > 0;
      if (!board.hasBacklog && !(board.allDone && hasUnmergedBranches)) break;

      const branchInfo = hasUnmergedBranches ? `\n${this.getBranchOverview()}` : "";
      const repoPath = this.projectId ? this.workspace.repoPath(this.projectId) : "";
      const prompt = board.hasBacklog
        ? `[CONTINUATION] ${board.backlogCount} task(s) remain in backlog:\n${board.summary}\n\nSpawn workers for remaining backlog tasks.`
        : `[FINAL ASSEMBLY] All tasks done. ${worktreeCount} unmerged branch(es) remain:${branchInfo}\n\nMerge all branches in dependency order and report completion to the COO.\nThe project repo is at: ${repoPath}`;

      console.log(`[TeamLead ${this.id}] Continuation cycle ${i + 1}/${MAX_CONTINUATION_CYCLES} — ${board.hasBacklog ? `${board.backlogCount} backlog tasks remain` : "final assembly phase"}`);

      // Update snapshot for next iteration
      prevBoard = board;
      prevWorktreeCount = worktreeCount;

      result = await this.think(
        prompt,
        onToken,
        onReasoning,
        onReasoningEnd,
      );
    }

    return { text: result.text, thinking: result.thinking };
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
      merge_worker_branch: tool({
        description:
          "Auto-commit a worker's changes and merge their branch into main. " +
          "Use this when a worker has finished its task. " +
          "Merge foundational branches first (e.g., schema before routes).",
        parameters: z.object({
          workerId: z
            .string()
            .describe("The ID of the worker whose branch to merge"),
        }),
        execute: async ({ workerId }) => {
          return this.mergeWorkerBranch(workerId);
        },
      }),
      sync_worker_branch: tool({
        description:
          "Rebase a worker's branch onto the latest main so it picks up other workers' merged changes. " +
          "Use this when a worker depends on code that another worker has already merged.",
        parameters: z.object({
          workerId: z
            .string()
            .describe("The ID of the worker whose branch to sync"),
        }),
        execute: async ({ workerId }) => {
          return this.syncWorkerBranch(workerId);
        },
      }),
      get_branch_status: tool({
        description:
          "Show all active worktree branches with ahead/behind counts and diff summaries.",
        parameters: z.object({}),
        execute: async () => {
          return this.getBranchOverview();
        },
      }),
      create_task: tool({
        description:
          "Create a kanban task card for this project. Use this to decompose directives into trackable work items before spawning workers.",
        parameters: z.object({
          title: z.string().describe("Short task title"),
          description: z.string().optional().describe("Detailed task description"),
          column: z.enum(["backlog", "in_progress", "done"]).optional().describe("Column to place the task in (default: backlog)"),
          labels: z.array(z.string()).optional().describe("Labels/tags for the task"),
        }),
        execute: async ({ title, description, column, labels }) => {
          return this.createKanbanTask(title, description, column, labels);
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
        }),
        execute: async ({ taskId, column, assigneeAgentId, description, title }) => {
          return this.updateKanbanTask(taskId, { column, assigneeAgentId, description, title });
        },
      }),
      list_tasks: tool({
        description: "List all kanban tasks for this project.",
        parameters: z.object({}),
        execute: async () => {
          return this.listKanbanTasks();
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
      const isCodeWorker = entryTools.some((t) => CODE_TOOLS.has(t));
      const workerId = nanoid();
      let workspacePath: string | null = null;

      if (this.projectId && isCodeWorker && this.gitWorktree) {
        // Code workers get a git worktree
        if (!this.gitWorktree.hasRepo()) {
          this.gitWorktree.initRepo();
        }
        const wtInfo = this.gitWorktree.createWorktree(workerId);
        workspacePath = wtInfo.worktreePath;

        // Record worktree in DB for recovery
        db.insert(schema.worktrees)
          .values({
            agentId: workerId,
            projectId: this.projectId,
            branchName: wtInfo.branchName,
            worktreePath: wtInfo.worktreePath,
            status: "active",
          })
          .run();
      } else if (this.projectId) {
        // Non-code workers get a regular agent directory
        workspacePath = this.workspace.createAgentWorkspace(
          this.projectId,
          workerId,
        );
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
        systemPrompt: entry.systemPrompt + buildEnvironmentContext(entryTools),
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
        this.autoAssignTask(taskId, worker.id);
      }

      // Send the task to the worker
      this.sendMessage(worker.id, MessageType.Directive, task, {
        registryEntryName: entry.name,
      });

      const mode = isCodeWorker && this.gitWorktree ? " (worktree)" : "";
      const assigned = taskId ? ` Task ${taskId} moved to in_progress.` : "";
      console.log(`[TeamLead ${this.id}] Worker ${workerId} spawned and directive sent`);
      return `Spawned ${entry.name} worker (${worker.id})${mode} and assigned task.${assigned}`;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TeamLead ${this.id}] Failed to spawn worker: ${errMsg}`, err);
      return `Error spawning worker from ${registryEntryId}: ${errMsg}`;
    }
  }

  private mergeWorkerBranch(workerId: string): string {
    if (!this.gitWorktree) return "No git worktree manager available.";

    const result = this.gitWorktree.mergeBranch(workerId);

    // Update DB record
    if (this.projectId) {
      const db = getDb();
      db.update(schema.worktrees)
        .set({
          status: result.success ? "merged" : "conflict",
          mergedAt: result.success ? new Date().toISOString() : null,
        })
        .where(eq(schema.worktrees.agentId, workerId))
        .run();
    }

    // Always clean up worktree — whether merge succeeded, was empty, or conflicted
    try {
      this.gitWorktree.destroyWorktree(workerId);
    } catch (err) {
      console.warn(`[TeamLead ${this.id}] Failed to destroy worktree for ${workerId}:`, err);
    }

    return result.message;
  }

  private syncWorkerBranch(workerId: string): string {
    if (!this.gitWorktree) return "No git worktree manager available.";
    const result = this.gitWorktree.updateWorktree(workerId);
    return result.message;
  }

  private getBranchOverview(): string {
    if (!this.gitWorktree || !this.gitWorktree.hasRepo()) return "No active worktree branches.";

    const worktrees = this.gitWorktree.listWorktrees();
    if (worktrees.length === 0) return "No active worktree branches.";

    const lines = worktrees.map((wt) => {
      const diff = this.gitWorktree!.getBranchDiff(wt.agentId);
      const status = this.gitWorktree!.getBranchStatus(wt.agentId);
      return [
        `**${wt.branchName}** (${wt.agentId})`,
        `  Ahead: ${wt.ahead}, Behind: ${wt.behind}`,
        status.trim() ? `  Uncommitted: ${status.trim()}` : "  Uncommitted: (clean)",
        diff.trim() ? `  Diff vs main:\n${diff.trim().split("\n").map((l) => "    " + l).join("\n")}` : "  Diff vs main: (none)",
      ].join("\n");
    });

    return lines.join("\n\n");
  }

  /** Automatically move a worker's assigned task to "done" and fire the kanban change event. Returns the task title or null. */
  private markWorkerTaskDone(workerId: string): string | null {
    if (!this.projectId) return null;

    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, this.projectId))
      .all()
      .find((t) => t.assigneeAgentId === workerId && t.column !== "done");

    if (!task) return null;

    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({ column: "done", updatedAt: now })
      .where(eq(schema.kanbanTasks.id, task.id))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, task.id))
      .get();
    if (updated) {
      this.onKanbanChange?.("updated", updated as unknown as KanbanTask);
    }

    console.log(`[TeamLead ${this.id}] Auto-marked task "${task.title}" (${task.id}) as done for worker ${workerId}`);
    return task.title;
  }

  /** Auto-assign a kanban task to a worker: move to in_progress and set assigneeAgentId */
  private autoAssignTask(taskId: string, workerId: string): void {
    if (!this.projectId) return;

    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (!task) {
      console.warn(`[TeamLead ${this.id}] autoAssignTask: task ${taskId} not found`);
      return;
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
  }

  private createKanbanTask(
    title: string,
    description?: string,
    column?: string,
    labels?: string[],
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
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.kanbanTasks).values(task).run();

    this.onKanbanChange?.("created", task as unknown as KanbanTask);
    return `Task "${title}" created (${taskId}) in ${col}.`;
  }

  private updateKanbanTask(
    taskId: string,
    updates: { column?: string; assigneeAgentId?: string; description?: string; title?: string },
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

    return `Task "${existing.title}" updated.`;
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
        lines.push(`  - ${t.title} (${t.id})${assignee}`);
      }
    }
    return lines.join("\n");
  }

  getWorkers(): Map<string, Worker> {
    return this.workers;
  }

  /** Clean up all workers and worktrees on project deletion */
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

    // Destroy remaining worktrees and mark them abandoned in DB
    if (this.gitWorktree?.hasRepo() && this.projectId) {
      const db = getDb();
      const worktrees = this.gitWorktree.listWorktrees();
      for (const wt of worktrees) {
        try {
          this.gitWorktree.destroyWorktree(wt.agentId);
        } catch (err) {
          console.warn(`[TeamLead ${this.id}] Failed to destroy worktree ${wt.agentId}:`, err);
        }
        db.update(schema.worktrees)
          .set({ status: "abandoned" })
          .where(eq(schema.worktrees.agentId, wt.agentId))
          .run();
      }
    }

    super.destroy();
  }
}
