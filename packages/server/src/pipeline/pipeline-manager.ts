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
  fetchIssue,
  fetchCompareCommitsDiff,
} from "../github/github-service.js";
import { CODING_AGENT_REGISTRY_IDS } from "../agents/worker.js";
import type { COO } from "../agents/coo.js";
import type { GitHubIssue } from "../github/github-service.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_KICKBACKS = 2;

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
  kickbackCount: number;
  maxKickbacks: number;
  stageReports: Map<string, string>; // stage → report content
  prBranch: string | null;
  targetBranch: string;             // project's configured branch (for diff base)
}

export class PipelineManager {
  private coo: COO;
  private io: TypedServer;
  /** In-memory pipeline states keyed by kanban task ID */
  private pipelines = new Map<string, PipelineState>();
  /** Prevent duplicate coding-agent triage dispatches (keyed by issue number) */
  private triageInFlight = new Set<number>();
  /** Track in-flight coding-agent triage ops (keyed by kanban task ID) */
  private triageSessions = new Map<string, { projectId: string; repo: string; issue: GitHubIssue; taskId: string }>();

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
          inArray(schema.kanbanTasks.column, ["in_progress", "triage"]),
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
        kickbackCount: 0, // Reset on recovery — conservative
        maxKickbacks: MAX_KICKBACKS,
        stageReports: new Map(), // Reports lost on restart
        prBranch: task.prBranch ?? null,
        targetBranch: getConfig(`project:${task.projectId}:github:branch`) ?? "main",
      };

      this.pipelines.set(task.id, state);

      // Reconstruct triage session if this is a triage-stage task
      if (currentStage === "triage" && issueNumber && project?.githubRepo) {
        this.triageInFlight.add(issueNumber);
        // We don't have the full GitHubIssue object from DB, so fetch it async
        this.recoverTriageSession(task, issueNumber, project.githubRepo).catch((err) => {
          console.warn(`[PipelineManager] Failed to recover triage session for task ${task.id}:`, err);
        });
      }

      console.log(
        `[PipelineManager] Recovered pipeline for task ${task.id} at stage ${currentStage}`,
      );
    }

    if (tasks.length > 0) {
      console.log(`[PipelineManager] Recovered ${this.pipelines.size} pipeline(s) from DB`);
    }
  }

  /**
   * Recover a triage session by fetching the issue from GitHub.
   * If fetch fails, the pipeline state is still present so advancePipeline will work,
   * but handleTriageReport won't have the full issue context.
   */
  private async recoverTriageSession(
    task: { id: string; projectId: string; title: string; description: string },
    issueNumber: number,
    repo: string,
  ): Promise<void> {
    const token = getConfig("github:token");
    if (!token) return;

    try {
      const issue = await fetchIssue(repo, token, issueNumber);
      if (issue) {
        this.triageSessions.set(task.id, {
          projectId: task.projectId,
          repo,
          issue,
          taskId: task.id,
        });
      }
    } catch (err) {
      console.warn(`[PipelineManager] Could not fetch issue #${issueNumber} for triage recovery:`, err);
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
      kickbackCount: 0,
      maxKickbacks: MAX_KICKBACKS,
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

    // Resolve the triage agent's model
    const registry = new Registry();
    const agentId = triageStage.agentId || "builtin-triage";
    const entry = registry.get(agentId) ?? registry.get("builtin-triage");
    if (!entry) return;

    // If a coding agent is selected for triage, route through the worker pipeline
    if (CODING_AGENT_REGISTRY_IDS.has(agentId) && agentId !== "builtin-coder") {
      await this.runTriageViaCodingAgent(projectId, repo, issue, agentId);
      return;
    }

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

      // Create a kanban task in the Triage column (if one doesn't already exist)
      this.createTriageTask(projectId, issue.number, issue.title, parsed.classification, issue.body ?? "");
    } catch (err) {
      console.error(`[PipelineManager] Triage LLM call failed for #${issue.number}:`, err);
    }
  }

  /**
   * Route triage through the worker pipeline when a coding agent is selected.
   * Creates a kanban task, registers a single-stage pipeline, and delegates to sendStageDirective().
   */
  private async runTriageViaCodingAgent(
    projectId: string,
    repo: string,
    issue: GitHubIssue,
    agentId: string,
  ): Promise<void> {
    // Guard against duplicate dispatch
    if (this.triageInFlight.has(issue.number)) {
      console.log(`[PipelineManager] Triage already in flight for issue #${issue.number}, skipping`);
      return;
    }
    this.triageInFlight.add(issue.number);

    // Create kanban task in Triage column (idempotent)
    this.createTriageTask(projectId, issue.number, issue.title, "", issue.body ?? "");

    // Look up the created task by label
    const db = getDb();
    const label = `github-issue-${issue.number}`;
    const allTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, projectId))
      .all();
    const task = allTasks.find((t) => (t.labels as string[]).includes(label));
    if (!task) {
      console.error(`[PipelineManager] Could not find triage task for issue #${issue.number}`);
      this.triageInFlight.delete(issue.number);
      return;
    }

    // Register a single-stage pipeline so isPipelineTask() returns true
    // and advancePipeline() will intercept the worker report
    const state: PipelineState = {
      taskId: task.id,
      projectId,
      issueNumber: issue.number,
      repo,
      stages: ["triage"],
      currentStageIndex: 0,
      kickbackCount: 0,
      maxKickbacks: 0,
      stageReports: new Map(),
      prBranch: null,
      targetBranch: getConfig(`project:${projectId}:github:branch`) ?? "main",
    };
    this.pipelines.set(task.id, state);

    // Store triage metadata for completion handler
    this.triageSessions.set(task.id, { projectId, repo, issue, taskId: task.id });

    // Update kanban task pipeline stage
    this.updateTaskPipelineStage(task.id, "triage");

    // Send directive via the standard pipeline mechanism
    await this.sendStageDirective(state);

    console.log(`[PipelineManager] Dispatched coding-agent triage for issue #${issue.number} (task ${task.id})`);
  }

  /**
   * Process the worker report from a coding-agent triage.
   * Applies labels, posts classification comment, updates the kanban task.
   */
  private async handleTriageReport(
    session: { projectId: string; repo: string; issue: GitHubIssue; taskId: string },
    workerReport: string,
  ): Promise<void> {
    const { repo, issue, taskId } = session;
    const token = getConfig("github:token");

    // Parse the report using the same extractor as direct-LLM triage
    const parsed = extractTriageJson(workerReport);

    // Apply labels
    if (token) {
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
    }

    // Update kanban task description with classification
    const db = getDb();
    const now = new Date().toISOString();
    db.update(schema.kanbanTasks)
      .set({
        column: "triage",
        assigneeAgentId: null,
        pipelineStage: null,
        spawnCount: 0,
        description: `Triage: ${parsed.classification}\n\n${issue.body ?? ""}`,
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

    // Remove from in-flight set
    this.triageInFlight.delete(issue.number);

    console.log(`[PipelineManager] Coding-agent triaged issue #${issue.number} as "${parsed.classification}" (proceed=${parsed.shouldProceed})`);
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
      kickbackCount: 0,
      maxKickbacks: MAX_KICKBACKS,
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

    // Handle coding-agent triage completion (single-stage pipeline, no "next stage")
    if (currentStage === "triage" && this.triageSessions.has(taskId)) {
      const session = this.triageSessions.get(taskId)!;
      await this.handleTriageReport(session, workerReport);
      this.triageSessions.delete(taskId);
      this.pipelines.delete(taskId);
      this.updateTaskPipelineStage(taskId, null);
      return;
    }

    // Extract branch name from coder's report if present
    if (currentStage === "coder" && !state.prBranch) {
      const branchMatch = workerReport.match(
        /branch[:\s]+([a-zA-Z0-9._\/-]+)/i,
      ) ?? workerReport.match(
        /git checkout -b\s+([a-zA-Z0-9._\/-]+)/i,
      ) ?? workerReport.match(
        /pushed to\s+([a-zA-Z0-9._\/-]+)/i,
      );
      if (branchMatch) {
        state.prBranch = branchMatch[1];
      }

      // Fallback: check if the task's prBranch was set in DB (e.g., by PR creation)
      if (!state.prBranch) {
        const db = getDb();
        const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
        if (task?.prBranch) {
          state.prBranch = task.prBranch;
        }
      }
    }

    // Post completion comment on GitHub issue
    await this.postStageComment(state, currentStage, workerReport, "complete");

    // Security kickback logic
    if (currentStage === "security") {
      const hasFindings = this.securityHasFindings(workerReport);
      console.log(`[PipelineManager] Security review for task ${taskId}: hasFindings=${hasFindings}, kickbackCount=${state.kickbackCount}/${state.maxKickbacks}`);
      if (hasFindings && state.kickbackCount < state.maxKickbacks) {
        state.kickbackCount++;

        // Find coder stage index
        const coderIndex = state.stages.indexOf("coder");
        if (coderIndex >= 0) {
          state.currentStageIndex = coderIndex;

          // Update kanban task
          this.updateTaskPipelineStage(taskId, "coder");

          // Post kickback comment
          if (state.issueNumber && state.repo) {
            const token = getConfig("github:token");
            if (token) {
              try {
                await createIssueComment(
                  state.repo, token, state.issueNumber,
                  `🔄 Security review found issues (attempt ${state.kickbackCount}/${state.maxKickbacks}). Sending back to coder for fixes.`,
                );
              } catch { /* best effort */ }
            }
          }

          // Send coder directive with security findings
          await this.sendStageDirective(state, workerReport);
          return;
        }
      } else if (hasFindings) {
        // Max kickbacks reached — proceed with a warning
        if (state.issueNumber && state.repo) {
          const token = getConfig("github:token");
          if (token) {
            try {
              await createIssueComment(
                state.repo, token, state.issueNumber,
                `⚠️ Security review still has findings after ${state.maxKickbacks} attempts. Proceeding with remaining stages.`,
              );
            } catch { /* best effort */ }
          }
        }
      }
    }

    // Advance to next stage
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
      kickbackCount: 0,
      maxKickbacks: MAX_KICKBACKS,
      stageReports: new Map(),
      prBranch: branchName,
      targetBranch: getConfig(`project:${task.projectId}:github:branch`) ?? "main",
    };

    // Store review feedback context
    state.stageReports.set("review_feedback", feedback);

    this.pipelines.set(taskId, state);
    this.updateTaskPipelineStage(taskId, "coder");

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
        } else if (state.stageReports.has("security")) {
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
        } else {
          // Initial implementation
          parts.push(
            `\nCreate a feature branch, implement the solution, commit, and push.`,
            `Do NOT create a pull request — a later stage will handle that.`,
          );
        }
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
          );
          parts.push(diffSection);
        } else {
          parts.push(
            `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for security vulnerabilities.`,
            `Check for: injection attacks, XSS, CSRF, auth issues, data exposure, dependency risks.`,
            `If you find issues, describe them clearly. If no issues found, state that explicitly.`,
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
        // Include reports from prior stages
        for (const [stage, report] of state.stageReports) {
          if (stage === "review_feedback") continue;
          parts.push(`\n--- ${stage.toUpperCase()} REPORT ---\n${report.slice(0, 1500)}\n--- END ---`);
        }
        break;
      }
      case "triage": {
        // Coding-agent triage — instruct the agent to analyze the issue with codebase context
        const triageSession = this.triageSessions.get(state.taskId);
        if (triageSession) {
          const { issue } = triageSession;
          parts.push(
            `\nYou are triaging a GitHub issue. Read the codebase for context, then classify the issue.`,
            `\nIssue #${issue.number}: ${issue.title}`,
            `\n${issue.body ?? "(no description)"}`,
            `\nLabels: ${issue.labels.map((l) => l.name).join(", ") || "none"}`,
            `Assignees: ${issue.assignees.map((a) => a.login).join(", ") || "none"}`,
            `\nAfter analyzing the issue and relevant code, respond with ONLY a JSON object:`,
            `{"classification": "<bug|feature|enhancement|user-error|duplicate|question|documentation>",`,
            ` "shouldProceed": <true if implementation is needed, false otherwise>,`,
            ` "comment": "<your analysis and reasoning>",`,
            ` "labels": ["<label1>", "<label2>"]}`,
          );
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

  private securityHasFindings(report: string): boolean {
    const lower = report.toLowerCase();

    // Explicit "no issues" / "clean" signals override keyword matches
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
