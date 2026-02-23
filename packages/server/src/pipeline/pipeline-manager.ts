import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
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
} from "../github/github-service.js";
import type { COO } from "../agents/coo.js";
import type { GitHubIssue } from "../github/github-service.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const MAX_KICKBACKS = 2;

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
}

export class PipelineManager {
  private coo: COO;
  private io: TypedServer;
  /** In-memory pipeline states keyed by kanban task ID */
  private pipelines = new Map<string, PipelineState>();

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
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
        // Strip code fences if present
        const cleaned = result.text.replace(/```json\n?|\n?```/g, "").trim();
        parsed = JSON.parse(cleaned);
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
    };
    this.pipelines.set(taskId, state);

    // Update kanban task with pipeline stage
    this.updateTaskPipelineStage(taskId, enabledStages[0]);

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
    const state = this.pipelines.get(taskId);
    if (!state) return;

    const currentStage = state.stages[state.currentStageIndex];

    // Store the report
    state.stageReports.set(currentStage, workerReport);

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
    }

    // Post completion comment on GitHub issue
    await this.postStageComment(state, currentStage, workerReport, "complete");

    // Security kickback logic
    if (currentStage === "security") {
      const hasFindings = this.securityHasFindings(workerReport);
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
      // Pipeline complete
      this.pipelines.delete(taskId);
      this.updateTaskPipelineStage(taskId, null);

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
        parts.push(
          `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for security vulnerabilities.`,
          `Check for: injection attacks, XSS, CSRF, auth issues, data exposure, dependency risks.`,
          `If you find issues, describe them clearly. If no issues found, state that explicitly.`,
        );
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
        parts.push(
          `\nReview the code on branch \`${state.prBranch ?? "(see coder report)"}\` for quality and correctness.`,
        );
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
        });
      }
    }

    console.log(`[PipelineManager] Sent ${currentStage} directive for task ${state.taskId}`);
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
      pipelineAttempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.kanbanTasks).values(task).run();
    this.io.emit("kanban:task-created", task as unknown as KanbanTask);
    console.log(`[PipelineManager] Created triage task for issue #${issueNumber}`);
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private securityHasFindings(report: string): boolean {
    const lower = report.toLowerCase();
    return (
      lower.includes("vulnerability") ||
      lower.includes("security issue") ||
      lower.includes("security risk") ||
      lower.includes("found issue") ||
      lower.includes("xss") ||
      lower.includes("injection") ||
      lower.includes("csrf") ||
      (lower.includes("found") && lower.includes("issue"))
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
