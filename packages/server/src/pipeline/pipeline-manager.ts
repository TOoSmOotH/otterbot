import { nanoid } from "nanoid";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import { generateText } from "ai";
import type { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  KanbanTask,
  ProjectPipelineConfig,
} from "@otterbot/shared";
import { MessageType, PIPELINE_STAGES } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig } from "../auth/auth.js";
import { getAgentModelOverride } from "../settings/settings.js";
import { resolveModel } from "../llm/adapter.js";
import { Registry } from "../registry/registry.js";
import {
  createIssueComment,
  addLabelsToIssue,
  fetchCompareCommitsDiff,
  fetchPullRequests,
} from "../github/github-service.js";
import type { COO } from "../agents/coo.js";
import type { GitHubIssue } from "../github/github-service.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_SPAWN_RETRIES = 3;

interface TriageResult {
  classification: string;
  shouldProceed: boolean;
  comment: string;
  labels: string[];
}

/**
 * Extract triage JSON from an LLM response. Handles:
 * 1. Pure JSON
 * 2. JSON inside code fences
 * 3. JSON object embedded in free-form text
 */
function extractTriageJson(text: string): TriageResult {
  // 1. Strip code fences and try direct parse
  const stripped = text.replace(/```(?:json)?\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(stripped) as TriageResult;
  } catch { /* continue */ }

  // 2. Find a JSON object anywhere in the text (greedy braces)
  const jsonMatch = text.match(/\{[\s\S]*"classification"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]) as TriageResult;
    } catch { /* continue */ }
  }

  // 3. Infer from free-form text as last resort
  const lower = text.toLowerCase();
  const classifications = [
    "bug", "feature", "enhancement", "user-error",
    "duplicate", "question", "documentation",
  ];
  const classification =
    classifications.find((c) => lower.includes(c)) ?? "question";
  const shouldProceed = ["bug", "feature", "enhancement"].includes(classification);
  // Use first ~300 chars of the response as the comment
  const comment = text.slice(0, 300).replace(/\n+/g, " ").trim();
  const labels = [classification];

  console.warn(
    `[PipelineManager] Triage response was not JSON — inferred classification="${classification}"`,
  );
  return { classification, shouldProceed, comment, labels };
}

/** Implementation-phase stages (excludes triage) */
const IMPLEMENTATION_STAGE_KEYS = PIPELINE_STAGES
  .filter((s) => s.key !== "triage")
  .map((s) => s.key);

interface PipelineState {
  taskId: string;
  projectId: string;
  issueNumber: number | null;
  repo: string | null;
  stages: string[];           // enabled stages in order (excluding triage)
  currentStageIndex: number;
  spawnRetryCount: number;
  lastKickbackSource: string | null;
  stageReports: Map<string, string>; // stage → report content
  prBranch: string | null;
  targetBranch: string;             // project's configured branch (for diff base)
}

export class PipelineManager {
  private coo: COO;
  private io: TypedServer;
  /** In-memory pipeline states keyed by kanban task ID */
  private pipelines = new Map<string, PipelineState>();
  /** Timer for periodic stale pipeline sweep */
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Stale pipeline threshold in milliseconds (30 minutes) */
  private static readonly STALE_THRESHOLD_MS = 30 * 60 * 1000;
  /** Sweep interval in milliseconds (10 minutes) */
  private static readonly SWEEP_INTERVAL_MS = 10 * 60 * 1000;

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  /**
   * Initialize the pipeline manager: recover in-flight pipelines from DB
   * and start the periodic stale pipeline sweep.
   * Must be called after construction (DB must be ready).
   */
  async init(): Promise<void> {
    this.recoverPipelines();
    this.sweepTimer = setInterval(() => {
      this.sweepStalePipelines().catch((err) => {
        console.error("[PipelineManager] Stale pipeline sweep failed:", err);
      });
    }, PipelineManager.SWEEP_INTERVAL_MS);
  }

  /** Stop the periodic sweep timer. */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Scan the DB for tasks with active pipeline state and reconstruct
   * in-memory PipelineState objects so pipelines survive server restarts.
   */
  private recoverPipelines(): void {
    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          isNotNull(schema.kanbanTasks.pipelineStage),
          inArray(schema.kanbanTasks.column, ["in_progress"]),
        ),
      )
      .all();

    for (const task of tasks) {
      // Skip if already tracked (shouldn't happen on fresh startup)
      if (this.pipelines.has(task.id)) continue;

      const stages = (task.pipelineStages as string[]) ?? [];
      const currentStage = task.pipelineStage!;
      const currentStageIndex = stages.indexOf(currentStage);

      if (currentStageIndex < 0) {
        console.warn(
          `[PipelineManager] Recovery: task ${task.id} has pipelineStage="${currentStage}" not found in stages [${stages.join(",")}] — skipping`,
        );
        continue;
      }

      // Extract issue number from labels
      const issueLabel = (task.labels as string[]).find((l) => l.startsWith("github-issue-"));
      const issueNumber = issueLabel ? parseInt(issueLabel.replace("github-issue-", ""), 10) : null;

      // Look up project for repo info
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, task.projectId))
        .get();

      const state: PipelineState = {
        taskId: task.id,
        projectId: task.projectId,
        issueNumber,
        repo: project?.githubRepo ?? null,
        stages,
        currentStageIndex,
        spawnRetryCount: 0,
        lastKickbackSource: null,
        stageReports: new Map(), // Reports lost on restart
        prBranch: task.prBranch ?? null,
        targetBranch: getConfig(`project:${task.projectId}:github:branch`) ?? "main",
      };

      this.pipelines.set(task.id, state);

      console.log(
        `[PipelineManager] Recovered pipeline for task ${task.id} at stage ${currentStage}`,
      );
    }

    if (tasks.length > 0) {
      console.log(`[PipelineManager] Recovered ${this.pipelines.size} pipeline(s) from DB`);
    }
  }

  /**
   * Try to recover a single pipeline from DB state.
   * Used when advancePipeline() receives a report for a task with no in-memory state.
   */
  private tryRecoverPipeline(taskId: string): PipelineState | null {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();

    if (!task || !task.pipelineStage) return null;

    const stages = (task.pipelineStages as string[]) ?? [];
    const currentStage = task.pipelineStage;
    const currentStageIndex = stages.indexOf(currentStage);

    if (currentStageIndex < 0) return null;

    const issueLabel = (task.labels as string[]).find((l) => l.startsWith("github-issue-"));
    const issueNumber = issueLabel ? parseInt(issueLabel.replace("github-issue-", ""), 10) : null;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();

    const state: PipelineState = {
      taskId: task.id,
      projectId: task.projectId,
      issueNumber,
      repo: project?.githubRepo ?? null,
      stages,
      currentStageIndex,
      spawnRetryCount: 0,
      lastKickbackSource: null,
      stageReports: new Map(),
      prBranch: task.prBranch ?? null,
      targetBranch: getConfig(`project:${task.projectId}:github:branch`) ?? "main",
    };

    this.pipelines.set(taskId, state);
    console.log(
      `[PipelineManager] Recovered pipeline for task ${taskId} at stage ${currentStage} (on-demand)`,
    );
    return state;
  }

  /**
   * Reset a task back to backlog when pipeline recovery fails.
   * This prevents the task from being permanently stuck.
   */
  private resetTaskToBacklog(taskId: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({
        column: "backlog",
        pipelineStage: null,
        assigneeAgentId: null,
        updatedAt: now,
      })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }

    console.log(`[PipelineManager] Reset task ${taskId} to backlog`);
  }

  // ─── Config helpers ──────────────────────────────────────────────

  /** Load pipeline config for a project from config KV */
  getConfig(projectId: string): ProjectPipelineConfig | null {
    const raw = getConfig(`project:${projectId}:pipeline-config`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ProjectPipelineConfig;
    } catch {
      return null;
    }
  }

  /** Save pipeline config for a project */
  setConfig(projectId: string, config: ProjectPipelineConfig): void {
    setConfig(`project:${projectId}:pipeline-config`, JSON.stringify(config));
  }

  /** Check if pipeline is enabled for a project */
  isEnabled(projectId: string): boolean {
    const config = this.getConfig(projectId);
    return config?.enabled === true;
  }

  /** Check if a task is being managed by the pipeline */
  isPipelineTask(taskId: string): boolean {
    return this.pipelines.has(taskId);
  }

  // ─── Triage ──────────────────────────────────────────────────────

  /**
   * Run triage on a GitHub issue: direct LLM call (not a spawned worker).
   * Posts a classification comment and applies labels. Does NOT create tasks.
   */
  async runTriage(
    projectId: string,
    repo: string,
    issue: GitHubIssue,
  ): Promise<void> {
    const token = getConfig("github:token");
    if (!token) return;

    const config = this.getConfig(projectId);
    const triageStage = config?.stages?.triage;
    if (!triageStage?.enabled) return;

    // Resolve the triage agent's model (always use lightweight LLM, never coding-agent)
    const registry = new Registry();
    const agentId = triageStage.agentId || "builtin-triage";
    const entry = registry.get(agentId) ?? registry.get("builtin-triage");
    if (!entry) return;

    // Post start comment
    try {
      await createIssueComment(
        repo, token, issue.number,
        `🔍 Analyzing this issue...`,
      );
    } catch (err) {
      console.error(`[PipelineManager] Failed to post triage start comment on #${issue.number}:`, err);
    }

    // Build prompt
    const issueText =
      `Issue #${issue.number}: ${issue.title}\n\n` +
      `${issue.body ?? "(no description)"}\n\n` +
      `Labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}\n` +
      `Assignees: ${issue.assignees.map((a) => a.login).join(", ") || "none"}`;

    try {
      const model = resolveModel({
        provider:
          getAgentModelOverride(entry.id)?.provider ??
          getConfig("worker_provider") ??
          getConfig("coo_provider") ??
          entry.defaultProvider,
        model:
          getAgentModelOverride(entry.id)?.model ??
          getConfig("worker_model") ??
          getConfig("coo_model") ??
          entry.defaultModel,
      });

      const result = await generateText({
        model,
        system: entry.systemPrompt,
        prompt: issueText,
        maxTokens: 1000,
      });

      // Parse JSON response
      let parsed: {
        classification: string;
        shouldProceed: boolean;
        comment: string;
        labels: string[];
      };

      try {
        parsed = extractTriageJson(result.text);
      } catch {
        console.error(`[PipelineManager] Failed to parse triage response for #${issue.number}:`, result.text);
        return;
      }

      // Apply labels
      if (parsed.labels && parsed.labels.length > 0) {
        try {
          await addLabelsToIssue(repo, token, issue.number, parsed.labels);
        } catch (err) {
          console.error(`[PipelineManager] Failed to apply labels to #${issue.number}:`, err);
        }
      }

      // Apply "triaged" label so we don't re-process
      try {
        await addLabelsToIssue(repo, token, issue.number, ["triaged"]);
      } catch (err) {
        console.error(`[PipelineManager] Failed to apply triaged label to #${issue.number}:`, err);
      }

      // Post classification comment
      const proceedText = parsed.shouldProceed
        ? "Proceeding with implementation when assigned."
        : "No implementation needed — labeling accordingly.";
      const commentBody =
        `**Triage:** ${parsed.classification}\n\n` +
        `${parsed.comment}\n\n` +
        `${proceedText}`;

      try {
        await createIssueComment(repo, token, issue.number, commentBody);
      } catch (err) {
        console.error(`[PipelineManager] Failed to post triage comment on #${issue.number}:`, err);
      }

      console.log(`[PipelineManager] Triaged issue #${issue.number} as "${parsed.classification}" (proceed=${parsed.shouldProceed})`);

      // Create a kanban task in the Triage column (read-only view of all open issues)
      this.createTriageTask(projectId, issue.number, issue.title, parsed.classification, issue.body ?? "");
    } catch (err) {
      console.error(`[PipelineManager] Triage LLM call failed for #${issue.number}:`, err);
    }
  }

  // ─── Implementation pipeline ─────────────────────────────────────

  /**
   * Start the implementation pipeline for a task.
   * Called when an assigned issue is detected or a non-GitHub task is routed through the pipeline.
   */
  async startImplementation(
    taskId: string,
    projectId: string,
    issueNumber: number | null,
    repo: string | null,
  ): Promise<void> {
    const config = this.getConfig(projectId);
    if (!config?.enabled) {
      // Fallback: send existing direct directive to TeamLead
      this.sendFallbackDirective(taskId, projectId);
      return;
    }

    // Build ordered list of enabled implementation stages
    const enabledStages: string[] = [];
    for (const stageKey of IMPLEMENTATION_STAGE_KEYS) {
      const stageConfig = config.stages[stageKey];
      if (stageConfig?.enabled !== false) {
        // Default to enabled if not explicitly disabled
        enabledStages.push(stageKey);
      }
    }

    if (enabledStages.length === 0) {
      // No stages enabled — fall back
      this.sendFallbackDirective(taskId, projectId);
      return;
    }

    // Initialize pipeline state
    const state: PipelineState = {
      taskId,
      projectId,
      issueNumber,
      repo,
      stages: enabledStages,
      currentStageIndex: 0,
      spawnRetryCount: 0,
      lastKickbackSource: null,
      stageReports: new Map(),
      prBranch: null,
      targetBranch: getConfig(`project:${projectId}:github:branch`) ?? "main",
    };
    this.pipelines.set(taskId, state);

    // Update kanban task with pipeline stage and stage list
    const db = getDb();
    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({ pipelineStages: enabledStages, pipelineStage: enabledStages[0], updatedAt: now })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();
    const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }

    // Post start comment on GitHub issue
    if (issueNumber && repo) {
      const token = getConfig("github:token");
      if (token) {
        try {
          await createIssueComment(
            repo, token, issueNumber,
            `🚀 Starting implementation pipeline: ${enabledStages.join(" → ")}`,
          );
        } catch (err) {
          console.error(`[PipelineManager] Failed to post pipeline start comment:`, err);
        }
      }
    }

    // Send directive for the first stage
    await this.sendStageDirective(state);
  }

  /**
   * Called when a worker finishes. Advances the pipeline to the next stage.
   */
  async advancePipeline(
    taskId: string,
    workerReport: string,
  ): Promise<void> {
    let state = this.pipelines.get(taskId);
    if (!state) {
      console.warn(`[PipelineManager] advancePipeline: no in-memory state for task ${taskId} — attempting recovery`);
      const recovered = this.tryRecoverPipeline(taskId);
      if (!recovered) {
        console.error(`[PipelineManager] advancePipeline: cannot recover task ${taskId} — moving to backlog`);
        this.resetTaskToBacklog(taskId);
        return;
      }
      state = recovered;
    }

    const currentStage = state.stages[state.currentStageIndex];

    // Store the report
    state.stageReports.set(currentStage, workerReport);

    // Safety net: catch spawn failure strings that slipped through the normal report path
    if (workerReport.startsWith("Error spawning worker") || workerReport.startsWith("REFUSED:")) {
      await this.handleSpawnFailure(taskId, workerReport);
      return;
    }

    // Extract branch name from the worker report (any stage may mention it)
    if (!state.prBranch) {
      state.prBranch = this.extractBranchName(workerReport);

      // Fallback: check if the task's prBranch was set in DB (e.g., by TeamLead's safety net)
      if (!state.prBranch) {
        const db = getDb();
        const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
        if (task?.prBranch) {
          state.prBranch = task.prBranch;
        }
      }

      // Fallback: look for an open PR referencing this issue
      if (!state.prBranch && state.issueNumber && state.repo) {
        state.prBranch = await this.resolveIssueBranch(state.repo, state.issueNumber);
      }

      // Persist to DB so it survives server restarts and is available to later stages
      if (state.prBranch) {
        const db = getDb();
        const now = new Date().toISOString();
        db.update(schema.kanbanTasks)
          .set({ prBranch: state.prBranch, updatedAt: now })
          .where(eq(schema.kanbanTasks.id, taskId))
          .run();
        console.log(`[PipelineManager] Resolved branch "${state.prBranch}" for task ${taskId}`);
      }
    }

    // Post completion comment on GitHub issue
    await this.postStageComment(state, currentStage, workerReport, "complete");

    // Parse structured verdict from report
    const verdict = this.parseVerdict(workerReport);
    const coderIndex = state.stages.indexOf("coder");

    // Stage-specific verdict handling with kickback support
    switch (currentStage) {
      case "coder": {
        const failed = verdict === "fail";
        if (failed) {
          // Coder failed — move to backlog
          console.warn(`[PipelineManager] Coder FAIL for task ${taskId} — moving to backlog`);
          if (state.issueNumber && state.repo) {
            const token = getConfig("github:token");
            if (token) {
              try {
                await createIssueComment(
                  state.repo, token, state.issueNumber,
                  `❌ Implementation failed. Task moved to backlog for review.`,
                );
              } catch { /* best effort */ }
            }
          }
          this.resetTaskToBacklog(taskId);
          this.pipelines.delete(taskId);
          return;
        }
        break;
      }
      case "security": {
        // Strip zero-file-changes warning — review-only stages never produce file changes
        const cleanedReport = workerReport.replace(/⚠️ WARNING: Task reported success but produced zero file changes[^\n]*/g, "").trim();
        const hasFindings = verdict === "fail" || (verdict === null && this.securityHasFindings(cleanedReport));
        console.log(`[PipelineManager] Security review for task ${taskId}: hasFindings=${hasFindings}`);
        if (hasFindings && coderIndex >= 0) {
          state.currentStageIndex = coderIndex;
          state.lastKickbackSource = "security";
          state.spawnRetryCount = 0;
          this.updateTaskPipelineStage(taskId, "coder");
          if (state.issueNumber && state.repo) {
            const token = getConfig("github:token");
            if (token) {
              try {
                await createIssueComment(
                  state.repo, token, state.issueNumber,
                  `🔄 Security review found issues. Sending back to coder for fixes.`,
                );
              } catch { /* best effort */ }
            }
          }
          await this.sendStageDirective(state, workerReport);
          return;
        }
        break;
      }
      case "tester": {
        const failed = verdict === "fail" || (verdict === null && this.testerHasFailed(workerReport));
        console.log(`[PipelineManager] Tester review for task ${taskId}: failed=${failed}`);
        if (failed && coderIndex >= 0) {
          state.currentStageIndex = coderIndex;
          state.lastKickbackSource = "tester";
          state.spawnRetryCount = 0;
          this.updateTaskPipelineStage(taskId, "coder");
          if (state.issueNumber && state.repo) {
            const token = getConfig("github:token");
            if (token) {
              try {
                await createIssueComment(
                  state.repo, token, state.issueNumber,
                  `🔄 Tests failed. Sending back to coder for fixes.`,
                );
              } catch { /* best effort */ }
            }
          }
          await this.sendStageDirective(state, workerReport);
          return;
        }
        break;
      }
      case "reviewer": {
        // Extract PR number from the reviewer's report (needed for completeTask routing)
        const prNumber = this.extractPRNumber(workerReport);
        if (prNumber) {
          const db = getDb();
          const now = new Date().toISOString();
          db.update(schema.kanbanTasks)
            .set({ prNumber, updatedAt: now })
            .where(eq(schema.kanbanTasks.id, taskId))
            .run();
        }

        const failed = verdict === "fail" || (verdict === null && this.reviewerHasIssues(workerReport));
        console.log(`[PipelineManager] Reviewer review for task ${taskId}: failed=${failed}`);
        if (failed && coderIndex >= 0) {
          state.currentStageIndex = coderIndex;
          state.lastKickbackSource = "reviewer";
          state.spawnRetryCount = 0;
          this.updateTaskPipelineStage(taskId, "coder");
          if (state.issueNumber && state.repo) {
            const token = getConfig("github:token");
            if (token) {
              try {
                await createIssueComment(
                  state.repo, token, state.issueNumber,
                  `🔄 Code review found issues. Sending back to coder for fixes.`,
                );
              } catch { /* best effort */ }
            }
          }
          await this.sendStageDirective(state, workerReport);
          return;
        }
        break;
      }
    }

    // Stage passed — advance to next stage
    state.spawnRetryCount = 0;
    state.currentStageIndex++;

    if (state.currentStageIndex >= state.stages.length) {
      // Pipeline complete — update DB first, then clean up memory
      this.updateTaskPipelineStage(taskId, null);
      this.completeTask(taskId, state, workerReport);
      this.pipelines.delete(taskId);

      // Post completion comment
      if (state.issueNumber && state.repo) {
        const token = getConfig("github:token");
        if (token) {
          try {
            await createIssueComment(
              state.repo, token, state.issueNumber,
              `✅ Implementation pipeline complete.`,
            );
          } catch { /* best effort */ }
        }
      }

      console.log(`[PipelineManager] Pipeline complete for task ${taskId}`);
      return;
    }

    const nextStage = state.stages[state.currentStageIndex];
    this.updateTaskPipelineStage(taskId, nextStage);
    await this.sendStageDirective(state);
  }

  /**
   * Handle a spawn failure for a pipeline task.
   * Retries with backoff up to MAX_SPAWN_RETRIES, then moves to backlog.
   */
  async handleSpawnFailure(taskId: string, errorMessage: string): Promise<void> {
    const state = this.pipelines.get(taskId);
    if (!state) {
      console.warn(`[PipelineManager] handleSpawnFailure: no state for task ${taskId}`);
      return;
    }

    state.spawnRetryCount++;
    const currentStage = state.stages[state.currentStageIndex];
    console.warn(
      `[PipelineManager] Spawn failure for task ${taskId} at stage ${currentStage} ` +
      `(attempt ${state.spawnRetryCount}/${MAX_SPAWN_RETRIES}): ${errorMessage}`,
    );

    if (state.spawnRetryCount <= MAX_SPAWN_RETRIES) {
      // Determine backoff delay
      const isConcurrencyRefusal = errorMessage.includes("REFUSED") && errorMessage.toLowerCase().includes("already running");
      const delayMs = isConcurrencyRefusal
        ? 30_000 * state.spawnRetryCount
        : 10_000 * state.spawnRetryCount;

      console.log(
        `[PipelineManager] Retrying spawn for task ${taskId} in ${delayMs / 1000}s`,
      );

      setTimeout(() => {
        // Guard: pipeline may have been cleaned up during the delay
        if (!this.pipelines.has(taskId)) return;
        this.sendStageDirective(state).catch((err) => {
          console.error(`[PipelineManager] Retry directive failed for task ${taskId}:`, err);
        });
      }, delayMs);
      return;
    }

    // Max retries exhausted — move to backlog
    console.error(
      `[PipelineManager] Max spawn retries exhausted for task ${taskId} — moving to backlog`,
    );

    // Append error note to task description
    const db = getDb();
    const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
    if (task) {
      const errorNote = `\n\n---\n⚠️ Pipeline spawn failed after ${MAX_SPAWN_RETRIES} retries at stage "${currentStage}": ${errorMessage}`;
      const updatedDesc = (task.description ?? "") + errorNote;
      db.update(schema.kanbanTasks)
        .set({ description: updatedDesc, updatedAt: new Date().toISOString() })
        .where(eq(schema.kanbanTasks.id, taskId))
        .run();
    }

    // Post GitHub comment
    if (state.issueNumber && state.repo) {
      const token = getConfig("github:token");
      if (token) {
        try {
          await createIssueComment(
            state.repo, token, state.issueNumber,
            `⚠️ Pipeline spawn failed after ${MAX_SPAWN_RETRIES} retries at stage "${currentStage}". Task moved to backlog for review.\n\nError: ${errorMessage}`,
          );
        } catch { /* best effort */ }
      }
    }

    this.resetTaskToBacklog(taskId);
    this.pipelines.delete(taskId);
  }

  /**
   * Handle PR review feedback — re-enter the pipeline at the coder stage.
   */
  async handleReviewFeedback(
    taskId: string,
    feedback: string,
    branchName: string,
    prNumber: number,
  ): Promise<void> {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (!task) return;

    const config = this.getConfig(task.projectId);
    if (!config?.enabled) return; // Not pipeline-managed

    // Look up repo info
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();

    // Extract issue number from labels
    const issueLabel = (task.labels as string[]).find((l) => l.startsWith("github-issue-"));
    const issueNumber = issueLabel ? parseInt(issueLabel.replace("github-issue-", ""), 10) : null;

    // Build enabled stages
    const enabledStages: string[] = [];
    for (const stageKey of IMPLEMENTATION_STAGE_KEYS) {
      const stageConfig = config.stages[stageKey];
      if (stageConfig?.enabled !== false) {
        enabledStages.push(stageKey);
      }
    }

    // Create a new pipeline state starting at coder
    const state: PipelineState = {
      taskId,
      projectId: task.projectId,
      issueNumber,
      repo: project?.githubRepo ?? null,
      stages: enabledStages,
      currentStageIndex: enabledStages.indexOf("coder"),
      spawnRetryCount: 0,
      lastKickbackSource: null,
      stageReports: new Map(),
      prBranch: branchName,
      targetBranch: getConfig(`project:${task.projectId}:github:branch`) ?? "main",
    };

    // Store review feedback context
    state.stageReports.set("review_feedback", feedback);

    this.pipelines.set(taskId, state);
    this.updateTaskPipelineStage(taskId, "coder");

    // Reset spawn count — PR feedback is a legitimate new cycle, not a failure loop
    db.update(schema.kanbanTasks)
      .set({ spawnCount: 0, updatedAt: new Date().toISOString() })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    // Post comment on issue
    if (issueNumber && state.repo) {
      const token = getConfig("github:token");
      if (token) {
        try {
          await createIssueComment(
            state.repo, token, issueNumber,
            `🔄 PR review feedback received. Re-entering pipeline at coder stage to address changes.`,
          );
        } catch { /* best effort */ }
      }
    }

    await this.sendStageDirective(state, feedback);
  }

  // ─── Directive building ──────────────────────────────────────────

  /**
   * Send a directive to TeamLead for the current pipeline stage.
   */
  private async sendStageDirective(
    state: PipelineState,
    extraContext?: string,
  ): Promise<void> {
    const currentStage = state.stages[state.currentStageIndex];
    const isLastStage = state.currentStageIndex === state.stages.length - 1;
    const config = this.getConfig(state.projectId);

    // Resolve the agent ID for this stage
    const stageConfig = config?.stages[currentStage];
    const stageInfo = PIPELINE_STAGES.find((s) => s.key === currentStage);

    // Build the directive text
    const parts: string[] = [];

    // Load task info
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, state.taskId))
      .get();

    if (!task) return;

    parts.push(`[PIPELINE STAGE: ${currentStage.toUpperCase()}]`);
    parts.push(`Task: "${task.title}" (${state.taskId})`);
    if (state.issueNumber) {
      parts.push(`GitHub Issue: #${state.issueNumber}`);
    }

    // Include task description (original issue body)
    if (task.description) {
      parts.push(`\nTask Description:\n${task.description}`);
    }

    // Stage-specific instructions
    switch (currentStage) {
      case "coder": {
        if (state.prBranch && state.stageReports.has("review_feedback")) {
          // PR review cycle — address feedback only
          parts.push(
            `\n[PR REVIEW CYCLE — Branch: \`${state.prBranch}\`]`,
            `A reviewer requested changes. Address ONLY the feedback below.`,
            `Check out branch \`${state.prBranch}\`, make fixes, commit, and push.`,
            `Do NOT create a new branch or PR.`,
          );
          if (extraContext) {
            parts.push(`\n--- REVIEW FEEDBACK ---\n${extraContext}\n--- END FEEDBACK ---`);
          }
        } else if (state.lastKickbackSource === "security") {
          // Security kickback — fix findings
          parts.push(
            `\n[SECURITY KICKBACK — Fix Required]`,
            `The security reviewer found issues. Address the findings below.`,
            state.prBranch ? `Work on branch \`${state.prBranch}\`.` : "",
            `Do NOT create a PR — just fix and push.`,
          );
          if (extraContext) {
            parts.push(`\n--- SECURITY FINDINGS ---\n${extraContext}\n--- END FINDINGS ---`);
          }
        } else if (state.lastKickbackSource === "tester") {
          // Test failure kickback
          parts.push(
            `\n[TEST FAILURE KICKBACK — Fix Required]`,
            `Tests failed on your implementation. Fix the code so tests pass.`,
            state.prBranch ? `Work on branch \`${state.prBranch}\`.` : "",
            `Do NOT create a PR — just fix and push.`,
          );
          if (extraContext) {
            parts.push(`\n--- TEST RESULTS ---\n${extraContext}\n--- END TEST RESULTS ---`);
          }
        } else if (state.lastKickbackSource === "reviewer") {
          // Review kickback
          parts.push(
            `\n[REVIEW KICKBACK — Fix Required]`,
            `The code reviewer found quality issues. Address the findings below.`,
            state.prBranch ? `Work on branch \`${state.prBranch}\`.` : "",
            `Do NOT create a PR — just fix and push.`,
          );
          if (extraContext) {
            parts.push(`\n--- REVIEW FINDINGS ---\n${extraContext}\n--- END REVIEW FINDINGS ---`);
          }
        } else {
          // Initial implementation
          parts.push(
            `\nCreate a feature branch, implement the solution, commit, and push.`,
            `Do NOT create a pull request — a later stage will handle that.`,
          );
        }
        parts.push(
          `\nIMPORTANT: End your report with exactly one of these verdicts on its own line:`,
          `  VERDICT: PASS — if you successfully implemented, committed, and pushed the changes`,
          `  VERDICT: FAIL — if you could not complete the implementation (explain why above)`,
        );
        break;
      }
      case "security": {
        const diffSection = await this.fetchDiffSection(state);
        if (diffSection) {
          parts.push(
            `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for security vulnerabilities.`,
            `Focus ONLY on the changes below — do not review unchanged code.`,
            `Check for: injection attacks, XSS, CSRF, auth issues, data exposure, dependency risks.`,
            `If you find issues, describe them clearly. If no issues found, state that explicitly.`,
            `\nIMPORTANT: End your review with exactly one of these verdicts on its own line:`,
            `  VERDICT: PASS — if no actionable security issues were found`,
            `  VERDICT: FAIL — if there are security issues that must be fixed before merging`,
          );
          parts.push(diffSection);
        } else {
          parts.push(
            `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for security vulnerabilities.`,
            `Check for: injection attacks, XSS, CSRF, auth issues, data exposure, dependency risks.`,
            `If you find issues, describe them clearly. If no issues found, state that explicitly.`,
            `\nIMPORTANT: End your review with exactly one of these verdicts on its own line:`,
            `  VERDICT: PASS — if no actionable security issues were found`,
            `  VERDICT: FAIL — if there are security issues that must be fixed before merging`,
          );
        }
        // Include coder's report for context
        const coderReport = state.stageReports.get("coder");
        if (coderReport) {
          parts.push(`\n--- CODER REPORT ---\n${coderReport.slice(0, 2000)}\n--- END ---`);
        }
        break;
      }
      case "tester": {
        parts.push(
          `\nRun tests on branch \`${state.prBranch ?? "(see coder report)"}\` to validate the implementation.`,
          `Install dependencies, build the project, and run the test suite.`,
          `Report test results clearly — pass/fail with details.`,
          `\nIMPORTANT: End your report with exactly one of these verdicts on its own line:`,
          `  VERDICT: PASS — if all tests pass`,
          `  VERDICT: FAIL — if any tests fail (include failure details above)`,
        );
        const coderReport = state.stageReports.get("coder");
        if (coderReport) {
          parts.push(`\n--- CODER REPORT ---\n${coderReport.slice(0, 2000)}\n--- END ---`);
        }
        break;
      }
      case "reviewer": {
        const diffSection = await this.fetchDiffSection(state);
        if (diffSection) {
          parts.push(
            `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for quality and correctness.`,
            `Focus your review on ONLY the changes shown below.`,
          );
          parts.push(diffSection);
        } else {
          parts.push(
            `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for quality and correctness.`,
          );
        }
        if (isLastStage) {
          parts.push(`After review, create a pull request for this branch.`);
        }
        parts.push(
          `\nIMPORTANT: End your report with exactly one of these verdicts on its own line:`,
          `  VERDICT: PASS — if the code is acceptable quality and ready to merge`,
          `  VERDICT: FAIL — if there are issues that must be fixed before merging (list them above)`,
        );
        // Include reports from prior stages
        for (const [stage, report] of state.stageReports) {
          if (stage === "review_feedback") continue;
          parts.push(`\n--- ${stage.toUpperCase()} REPORT ---\n${report.slice(0, 1500)}\n--- END ---`);
        }
        break;
      }
    }

    // Post start comment on GitHub issue
    await this.postStageComment(state, currentStage, "", "start");

    // Determine which agent to use for this stage
    let registryEntryId: string = stageInfo?.defaultAgentId ?? "builtin-coder";
    if (stageConfig?.agentId) {
      registryEntryId = stageConfig.agentId;
    }

    // Send directive to TeamLead
    const directiveContent = parts.join("\n");
    const teamLeads = this.coo.getTeamLeads();
    const teamLead = teamLeads.get(state.projectId);
    if (teamLead) {
      const bus = (this.coo as any).bus;
      if (bus) {
        bus.send({
          fromAgentId: "coo",
          toAgentId: teamLead.id,
          type: MessageType.Directive,
          content:
            `[PIPELINE] Spawn a "${stageInfo?.label ?? currentStage}" worker for task "${task.title}" (${state.taskId}).\n` +
            `Use registry entry: ${registryEntryId}\n\n` +
            `Worker directive:\n${directiveContent}`,
          projectId: state.projectId,
          metadata: {
            pipelineRegistryEntryId: registryEntryId,
            pipelineTaskId: state.taskId,
            pipelineBranch: state.prBranch ?? undefined,
          },
        });
        console.log(`[PipelineManager] Sent ${currentStage} directive for task ${state.taskId}`);
      }
    } else {
      console.error(
        `[PipelineManager] No TeamLead found for project ${state.projectId} — directive not sent for task ${state.taskId} stage ${currentStage}`,
      );
      // Move task back to backlog so it can be retried when TeamLead is available
      this.resetTaskToBacklog(state.taskId);
      this.pipelines.delete(state.taskId);
    }
  }

  // ─── GitHub comments ─────────────────────────────────────────────

  private async postStageComment(
    state: PipelineState,
    stage: string,
    report: string,
    phase: "start" | "complete",
  ): Promise<void> {
    if (!state.issueNumber || !state.repo) return;
    const token = getConfig("github:token");
    if (!token) return;

    let body: string;
    if (phase === "start") {
      const startComments: Record<string, string> = {
        triage: "🔍 Analyzing issue...",
        coder: "🔨 Beginning implementation...",
        security: "🔒 Running security review...",
        tester: "🧪 Running tests...",
        reviewer: "📝 Reviewing code...",
      };
      body = startComments[stage] ?? `Starting ${stage}...`;
    } else {
      // Completion — summarize the report
      const summary = report.length > 500
        ? report.slice(0, 500) + "\n\n_(truncated)_"
        : report;

      const completeComments: Record<string, (r: string) => string> = {
        coder: (r) => `✅ Implementation complete.\n\n${r}`,
        security: (r) =>
          this.securityHasFindings(report)
            ? `⚠️ Security issues found:\n\n${r}`
            : `✅ No security issues found.\n\n${r}`,
        tester: (r) => `🧪 Test results:\n\n${r}`,
        reviewer: (r) => `📝 Review complete.\n\n${r}`,
      };
      const formatter = completeComments[stage];
      body = formatter ? formatter(summary) : `${stage} complete: ${summary}`;
    }

    try {
      await createIssueComment(state.repo, token, state.issueNumber, body);
    } catch (err) {
      console.error(`[PipelineManager] Failed to post ${phase} comment for ${stage} on #${state.issueNumber}:`, err);
    }
  }

  // ─── Triage task helpers ─────────────────────────────────────

  /**
   * Create a kanban task in the Triage column for a triaged issue.
   * Skips creation if a task for this issue already exists.
   */
  createTriageTask(
    projectId: string,
    issueNumber: number,
    issueTitle: string,
    classification: string,
    body: string,
  ): void {
    const db = getDb();
    const label = `github-issue-${issueNumber}`;

    // Check if a task for this issue already exists
    const existingTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, projectId))
      .all();

    const alreadyTracked = existingTasks.some(
      (t) => (t.labels as string[]).includes(label),
    );
    if (alreadyTracked) return;

    const maxPos = existingTasks
      .filter((t) => t.column === "triage")
      .reduce((max, t) => Math.max(max, t.position), -1);

    const now = new Date().toISOString();
    const task = {
      id: nanoid(),
      projectId,
      title: `#${issueNumber}: ${issueTitle}`,
      description: classification ? `Triage: ${classification}\n\n${body}` : body,
      column: "triage" as const,
      position: maxPos + 1,
      assigneeAgentId: null,
      createdBy: "triage",
      labels: [label],
      blockedBy: [] as string[],
      retryCount: 0,
      spawnCount: 0,
      completionReport: null,
      pipelineStage: null,
      pipelineStages: [] as string[],
      pipelineAttempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.kanbanTasks).values(task).run();
    this.io.emit("kanban:task-created", task as unknown as KanbanTask);
    console.log(`[PipelineManager] Created triage task for issue #${issueNumber}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private async fetchDiffSection(state: PipelineState): Promise<string | null> {
    if (!state.prBranch || !state.repo) return null;
    const token = getConfig("github:token");
    if (!token) return null;

    try {
      const files = await fetchCompareCommitsDiff(
        state.repo,
        token,
        state.targetBranch,
        state.prBranch,
      );

      if (files.length === 0) return null;

      const MAX_DIFF_CHARS = 12_000;
      let diffText = "";
      let truncated = false;

      for (const file of files) {
        const entry = `## ${file.filename} (${file.status})\n${file.patch ?? "(binary or no patch)"}\n\n`;
        if (diffText.length + entry.length > MAX_DIFF_CHARS) {
          truncated = true;
          break;
        }
        diffText += entry;
      }

      if (truncated) {
        diffText += `\n... (diff truncated — ${files.length} files total)\n`;
      }

      return `\n--- CHANGED FILES ---\n${diffText}--- END CHANGED FILES ---`;
    } catch (err) {
      console.warn(`[PipelineManager] Failed to fetch diff for ${state.repo} ${state.prBranch}:`, err);
      return null;
    }
  }

  /** Parse a structured VERDICT: PASS/FAIL line from a worker report */
  private parseVerdict(report: string): "pass" | "fail" | null {
    if (/verdict:\s*pass/i.test(report)) return "pass";
    if (/verdict:\s*fail/i.test(report)) return "fail";
    return null;
  }

  private securityHasFindings(report: string): boolean {
    const verdict = this.parseVerdict(report);
    if (verdict === "pass") return false;
    if (verdict === "fail") return true;

    // Fallback: keyword heuristics for reports without a verdict line
    const lower = report.toLowerCase();
    const cleanSignals = [
      "no vulnerabilit",
      "no security issue",
      "no security risk",
      "no issues found",
      "no issues were found",
      "no findings",
      "no critical",
      "no concerns",
      "clean security",
      "security review passed",
      "passed security",
      "looks good",
      "lgtm",
      "no problems",
      "appears secure",
      "no significant",
      "safe to merge",
      "is safe to merge",
      "safe to proceed",
      "no issues identified",
      "does not introduce",
      "adheres to",
      "found no",
    ];
    if (cleanSignals.some((s) => lower.includes(s))) return false;

    // Look for affirmative finding signals
    return (
      /\bvulnerabilit(y|ies)\b/.test(lower) ||
      lower.includes("security issue") ||
      lower.includes("security risk") ||
      lower.includes("found issue") ||
      /\bxss\b/.test(lower) ||
      /\bsql.?injection\b/.test(lower) ||
      /\bcsrf\b/.test(lower) ||
      /\binjection\b/.test(lower) ||
      (lower.includes("found") && lower.includes("issue") && !lower.includes("no issue"))
    );
  }

  /** Heuristic fallback: detect test failures when tester doesn't include a verdict */
  private testerHasFailed(report: string): boolean {
    const lower = report.toLowerCase();

    // Clean signals — tests passed
    const passSignals = [
      "all tests pass",
      "tests passed",
      "0 failed",
      "no failures",
      "test suite passed",
      "all passing",
    ];
    if (passSignals.some((s) => lower.includes(s))) return false;

    // Fail signals
    return (
      lower.includes("test failed") ||
      lower.includes("tests failed") ||
      /\bFAIL\b/.test(report) ||
      lower.includes("exit code: 1") ||
      lower.includes("failing")
    );
  }

  /** Heuristic fallback: detect review issues when reviewer doesn't include a verdict */
  private reviewerHasIssues(report: string): boolean {
    const lower = report.toLowerCase();

    // Clean signals — review passed
    const passSignals = [
      "lgtm",
      "looks good",
      "approved",
      "no issues",
      "ready to merge",
      "no concerns",
    ];
    if (passSignals.some((s) => lower.includes(s))) return false;

    // Issue signals
    return (
      lower.includes("request changes") ||
      lower.includes("needs fix") ||
      lower.includes("must be fixed") ||
      lower.includes("reject")
    );
  }

  /** Extract a branch name from a worker report */
  private extractBranchName(report: string): string | null {
    const patterns = [
      /branch[:\s]+`?([a-zA-Z0-9._\/-]+)`?/i,
      /created branch\s+`?([a-zA-Z0-9._\/-]+)`?/i,
      /git checkout -b\s+`?([a-zA-Z0-9._\/-]+)`?/i,
      /pushed to\s+`?([a-zA-Z0-9._\/-]+)`?/i,
      /on branch\s+`?([a-zA-Z0-9._\/-]+)`?/i,
    ];
    for (const pattern of patterns) {
      const match = report.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  /**
   * Find the feature branch for an issue by looking for open PRs that reference it.
   * Falls back to the conventional feat/<issueNumber>-* branch naming pattern.
   */
  private async resolveIssueBranch(repo: string, issueNumber: number): Promise<string | null> {
    const token = getConfig("github:token");
    if (!token) return null;

    try {
      const prs = await fetchPullRequests(repo, token, { state: "open", per_page: 30 });
      // Find a PR whose body references the issue or whose branch matches the issue number
      for (const pr of prs) {
        const branchMatchesIssue = pr.head.ref.includes(String(issueNumber));
        const bodyReferencesIssue = pr.body?.includes(`#${issueNumber}`) ?? false;
        if (branchMatchesIssue || bodyReferencesIssue) {
          return pr.head.ref;
        }
      }
    } catch (err) {
      console.warn(`[PipelineManager] Failed to resolve branch for issue #${issueNumber}:`, err);
    }

    return null;
  }

  /** Extract a PR number from a worker report */
  private extractPRNumber(report: string): number | null {
    // Match github.com/{owner}/{repo}/pull/{number}
    const urlMatch = report.match(/github\.com\/[^\s]+\/pull\/(\d+)/);
    if (urlMatch) return parseInt(urlMatch[1], 10);
    // Match "PR #123" or "Pull Request #123"
    const prMatch = report.match(/(?:PR|Pull Request)\s*#(\d+)/i);
    if (prMatch) return parseInt(prMatch[1], 10);
    return null;
  }

  private updateTaskPipelineStage(taskId: string, stage: string | null): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({ pipelineStage: stage, updatedAt: now })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }
  }

  /**
   * Move a pipeline task to its final column when all stages are done.
   * If the task has a PR, move to in_review (PR monitor handles the rest).
   * Otherwise move to done with a completion report.
   */
  private completeTask(
    taskId: string,
    state: PipelineState,
    finalReport: string,
  ): void {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (!task) return;

    const now = new Date().toISOString();
    const hasPR = !!task.prNumber;
    const targetColumn = hasPR ? "in_review" : "done";

    const report = Array.from(state.stageReports.entries())
      .map(([stage, r]) => `## ${stage}\n${r}`)
      .join("\n\n");

    db.update(schema.kanbanTasks)
      .set({
        column: targetColumn,
        completionReport: report || finalReport,
        updatedAt: now,
      })
      .where(eq(schema.kanbanTasks.id, taskId))
      .run();

    const updated = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }

    console.log(
      `[PipelineManager] Task ${taskId} → ${targetColumn}${hasPR ? ` (PR #${task.prNumber})` : ""}`,
    );
  }

  /**
   * Periodic sweep for stale pipelines. If a task has been in_progress with a
   * pipelineStage set for longer than the threshold, re-send the stage directive
   * to dispatch a new worker (the original may have crashed).
   */
  private async sweepStalePipelines(): Promise<void> {
    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.column, "in_progress"),
          isNotNull(schema.kanbanTasks.pipelineStage),
        ),
      )
      .all();

    const now = Date.now();

    for (const task of tasks) {
      const updatedAt = new Date(task.updatedAt).getTime();
      if (now - updatedAt < PipelineManager.STALE_THRESHOLD_MS) continue;

      const state = this.pipelines.get(task.id);
      if (!state) {
        // No in-memory state — try to recover first
        const recovered = this.tryRecoverPipeline(task.id);
        if (!recovered) {
          console.warn(
            `[PipelineManager] Sweep: stale task ${task.id} at stage ${task.pipelineStage} — cannot recover, moving to backlog`,
          );
          this.resetTaskToBacklog(task.id);
          continue;
        }
        console.warn(
          `[PipelineManager] Sweep: stale task ${task.id} at stage ${task.pipelineStage} — recovered and resending directive`,
        );
        await this.sendStageDirective(recovered);
      } else {
        console.warn(
          `[PipelineManager] Sweep: stale task ${task.id} at stage ${task.pipelineStage} — resending directive`,
        );
        await this.sendStageDirective(state);
      }
    }
  }

  /** Fallback: send existing-style direct directive to TeamLead (no pipeline) */
  private sendFallbackDirective(taskId: string, projectId: string): void {
    const db = getDb();
    const task = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, taskId))
      .get();
    if (!task) return;

    const teamLeads = this.coo.getTeamLeads();
    const teamLead = teamLeads.get(projectId);
    if (teamLead) {
      const bus = (this.coo as any).bus;
      if (bus) {
        // Extract issue number from labels
        const issueLabel = (task.labels as string[]).find((l) => l.startsWith("github-issue-"));
        const issueNum = issueLabel ? issueLabel.replace("github-issue-", "") : "";

        bus.send({
          fromAgentId: "coo",
          toAgentId: teamLead.id,
          type: MessageType.Directive,
          content:
            `New task: "${task.title}"\n\n` +
            `${task.description || "(no description)"}\n\n` +
            `Task created on kanban board (${taskId}). ` +
            `Spawn a worker to create a feature branch, implement the fix, and open a PR.`,
          projectId,
        });
      }
    }
  }
}
