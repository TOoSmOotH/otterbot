import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, KanbanTask } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { resolveGiteaToken, resolveGiteaInstanceUrl } from "./account-resolver.js";
import {
  fetchPullRequest,
  fetchPullRequests,
  fetchPullRequestReviews,
  fetchPullRequestReviewComments,
  fetchCommitStatusesForRef,
  aggregateCommitStatus,
} from "./gitea-service.js";
import type { COO } from "../agents/coo.js";
import type { PipelineManager } from "../pipeline/pipeline-manager.js";
import type { MergeQueue } from "../merge-queue/merge-queue.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class GiteaPRMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private coo: COO;
  private io: TypedServer;
  private processedReviewIds = new Set<number>();
  private processedCIFailureSHAs = new Set<string>();
  private pipelineManager: PipelineManager | null = null;
  private mergeQueue: MergeQueue | null = null;

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  setPipelineManager(pm: PipelineManager): void {
    this.pipelineManager = pm;
  }

  setMergeQueue(mq: MergeQueue): void {
    this.mergeQueue = mq;
  }

  start(pollIntervalMs = 120_000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[GiteaPRMonitor] Poll error:", err);
      });
    }, pollIntervalMs);
    console.log(`[GiteaPRMonitor] Started polling every ${pollIntervalMs / 1000}s`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    const db = getDb();
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .all()
      .filter((t) => t.column === "in_review" && (t.prNumber != null || t.prBranch != null));

    for (const task of tasks) {
      try {
        // Only process tasks from Gitea-linked projects
        const project = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.id, task.projectId))
          .get();
        if (!project?.giteaRepo) continue;

        const token = resolveGiteaToken(task.projectId);
        const instanceUrl = resolveGiteaInstanceUrl(task.projectId);
        if (!token || !instanceUrl) continue;
        await this.checkPR(task, token, instanceUrl);
      } catch (err) {
        console.error(`[GiteaPRMonitor] Error checking PR for task ${task.id}:`, err);
      }
    }
  }

  private async checkPR(
    task: typeof schema.kanbanTasks.$inferSelect,
    token: string,
    instanceUrl: string,
  ): Promise<void> {
    if (this.mergeQueue?.isInQueue(task.id)) return;

    const db = getDb();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();

    if (!project?.giteaRepo) return;

    let prNumber = task.prNumber;
    if (!prNumber) {
      if (!task.prBranch) return;
      try {
        const prs = await fetchPullRequests(project.giteaRepo, token, instanceUrl, { state: "all" });
        const match = prs.find((pr) => pr.head.ref === task.prBranch);
        if (!match) {
          console.warn(`[GiteaPRMonitor] No PR found for branch ${task.prBranch} on task ${task.id}`);
          return;
        }
        const now = new Date().toISOString();
        db.update(schema.kanbanTasks)
          .set({ prNumber: match.number, updatedAt: now })
          .where(eq(schema.kanbanTasks.id, task.id))
          .run();
        prNumber = match.number;
        console.log(`[GiteaPRMonitor] Resolved prNumber=${match.number} from branch ${task.prBranch} for task ${task.id}`);
      } catch (err) {
        console.warn(`[GiteaPRMonitor] Failed to resolve prNumber from branch ${task.prBranch}:`, err);
        return;
      }
    }

    const pr = await fetchPullRequest(project.giteaRepo, token, prNumber, instanceUrl);

    if (pr.merged) {
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({
          column: "done",
          completionReport: `PR #${prNumber} merged successfully.`,
          updatedAt: now,
        })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();

      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      console.log(`[GiteaPRMonitor] PR #${prNumber} merged — task ${task.id} → done`);

      const teamLead = this.coo.getTeamLeads().get(task.projectId);
      if (teamLead) {
        await teamLead.notifyTaskDone(task.id);
      }
      return;
    }

    if (pr.state === "closed") {
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({
          column: "backlog",
          assigneeAgentId: null,
          updatedAt: now,
        })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();

      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      console.log(`[GiteaPRMonitor] PR #${prNumber} closed (not merged) — task ${task.id} → backlog`);
      return;
    }

    // PR is still open — check for reviews
    const reviews = await fetchPullRequestReviews(project.giteaRepo, token, prNumber, instanceUrl);

    // Check for approved reviews — auto-enqueue in merge queue
    if (this.mergeQueue) {
      const newApprovals = reviews.filter(
        (r) => r.state === "APPROVED" && !this.processedReviewIds.has(r.id),
      );
      if (newApprovals.length > 0) {
        for (const r of newApprovals) {
          this.processedReviewIds.add(r.id);
        }
        if (!this.mergeQueue.isInQueue(task.id)) {
          const entry = this.mergeQueue.approveForMerge(task.id);
          if (entry) {
            console.log(`[GiteaPRMonitor] PR #${prNumber} approved — auto-enqueued in merge queue`);
          }
        }
      }
    }

    // Gitea uses "REQUEST_CHANGES" instead of GitHub's "CHANGES_REQUESTED"
    const changeRequestStates = ["CHANGES_REQUESTED", "REQUEST_CHANGES", "REJECTED"];
    const newChangeRequests = reviews.filter(
      (r) => changeRequestStates.includes(r.state) && !this.processedReviewIds.has(r.id),
    );

    if (newChangeRequests.length > 0) {
      for (const r of newChangeRequests) {
        this.processedReviewIds.add(r.id);
      }
      for (const r of reviews) {
        this.processedReviewIds.add(r.id);
      }

      const reviewComments = await fetchPullRequestReviewComments(
        project.giteaRepo,
        token,
        prNumber,
        instanceUrl,
      );

      if (this.pipelineManager?.isEnabled(task.projectId)) {
        const branchName = task.prBranch || pr.head.ref;

        const feedbackParts: string[] = [];
        const changeRequests = reviews.filter((r) => changeRequestStates.includes(r.state));
        for (const review of changeRequests) {
          feedbackParts.push(`Review by ${review.user.login} (${review.state}):\n${review.body || "(no body)"}`);
        }
        if (reviewComments.length > 0) {
          feedbackParts.push("\nInline review comments:");
          for (const c of reviewComments) {
            const location = c.line ? `${c.path}:${c.line}` : c.path;
            feedbackParts.push(`- ${c.user.login} on \`${location}\`:\n  ${c.body}\n  \`\`\`diff\n  ${c.diff_hunk?.slice(-200) ?? ""}\n  \`\`\``);
          }
        }
        const feedback = feedbackParts.join("\n\n");

        const now = new Date().toISOString();
        db.update(schema.kanbanTasks)
          .set({ column: "in_progress", assigneeAgentId: null, updatedAt: now })
          .where(eq(schema.kanbanTasks.id, task.id))
          .run();
        const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
        if (updated) {
          this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
        }

        await this.pipelineManager.handleReviewFeedback(
          task.id,
          feedback,
          branchName,
          prNumber,
        );

        console.log(`[GiteaPRMonitor] Routed PR #${prNumber} review feedback through pipeline for task ${task.id}`);
        return;
      }

      await this.requestChangesWorker(task, project, pr, reviews, reviewComments);
      return;
    }

    // Check CI status
    await this.checkCIStatus(task, project, pr, token, instanceUrl);
  }

  private async checkCIStatus(
    task: typeof schema.kanbanTasks.$inferSelect,
    project: typeof schema.projects.$inferSelect,
    pr: Awaited<ReturnType<typeof fetchPullRequest>>,
    token: string,
    instanceUrl: string,
  ): Promise<void> {
    if (!project.giteaRepo) return;

    const headSHA = pr.head.sha;
    if (this.processedCIFailureSHAs.has(headSHA)) return;

    let statuses;
    try {
      statuses = await fetchCommitStatusesForRef(project.giteaRepo, token, headSHA, instanceUrl);
    } catch (err) {
      console.warn(`[GiteaPRMonitor] Failed to fetch commit statuses for ${headSHA}:`, err);
      return;
    }

    const ciStatus = aggregateCommitStatus(statuses);
    if (ciStatus !== "failure") return;

    this.processedCIFailureSHAs.add(headSHA);

    const failedStatuses = statuses.filter(
      (s) => s.status === "failure" || s.status === "error",
    );
    const failureSummary = failedStatuses
      .map((s) => `- **${s.context}**: ${s.status}${s.target_url ? ` ([details](${s.target_url}))` : ""}`)
      .join("\n");

    const prNumber = pr.number;
    const branchName = task.prBranch || pr.head.ref;

    const feedback =
      `CI checks failed on PR #${prNumber} (commit ${headSHA.slice(0, 7)}).\n\n` +
      `Failed checks:\n${failureSummary}\n\n` +
      `Please investigate the CI failures and fix them on branch \`${branchName}\`.`;

    console.log(`[GiteaPRMonitor] CI failure detected on PR #${prNumber} (${headSHA.slice(0, 7)}) — routing for fixes`);

    if (this.pipelineManager?.isEnabled(task.projectId)) {
      const db = getDb();
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({ column: "in_progress", assigneeAgentId: null, updatedAt: now })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();
      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      await this.pipelineManager.handleCIFailure(
        task.id,
        feedback,
        branchName,
        prNumber,
      );
      return;
    }

    await this.ciFailureWorker(task, project, pr, feedback);
  }

  private async ciFailureWorker(
    task: typeof schema.kanbanTasks.$inferSelect,
    project: typeof schema.projects.$inferSelect,
    pr: Awaited<ReturnType<typeof fetchPullRequest>>,
    feedback: string,
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const branchName = task.prBranch || pr.head.ref;

    const ciDescription =
      `[CI FAILURE — PR #${task.prNumber} on branch \`${branchName}\`]\n\n` +
      `This task has an open PR but CI checks are failing.\n` +
      `The worker must ONLY fix the CI failures — do NOT redo the original task.\n\n` +
      `--- CI FAILURE DETAILS ---\n${feedback}\n--- END DETAILS ---\n\n` +
      `Instructions: Check out branch \`${branchName}\`, investigate and fix the CI failures, commit, and push. ` +
      `Do NOT create a new branch or PR — pushing to this branch auto-updates the existing PR #${task.prNumber}.`;

    db.update(schema.kanbanTasks)
      .set({
        column: "in_progress",
        description: ciDescription,
        assigneeAgentId: null,
        updatedAt: now,
      })
      .where(eq(schema.kanbanTasks.id, task.id))
      .run();

    const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }

    const teamLeads = this.coo.getTeamLeads();
    const teamLead = teamLeads.get(task.projectId);
    if (teamLead) {
      const bus = (this.coo as any).bus;
      if (bus) {
        const taskLabel = task.taskNumber ? `Issue #${task.taskNumber}` : task.id;
        bus.send({
          fromAgentId: "coo",
          toAgentId: teamLead.id,
          type: MessageType.Directive,
          content:
            `CI FAILURE for existing task "${task.title}" (${taskLabel}) — this task is already in_progress on the kanban board.\n\n` +
            `IMPORTANT: Do NOT create any new tasks. Do NOT redo the original work. ` +
            `Spawn exactly ONE worker to fix the CI failures on the EXISTING task (${task.id}). ` +
            `The task description already contains the CI failure details and branch instructions.\n\n` +
            `Use update_task to assign the worker to task ${task.id}, then spawn_worker with the CI failure feedback.\n\n` +
            `CI summary: PR #${task.prNumber} on branch \`${branchName}\` has failing CI checks.\n` +
            `${feedback}`,
          projectId: task.projectId,
        });
      }
    }

    const prTaskLabel = task.taskNumber ? `Issue #${task.taskNumber} (${task.id})` : task.id;
    console.log(`[GiteaPRMonitor] CI failure on PR #${task.prNumber} — sent directive for ${prTaskLabel}`);
  }

  private async requestChangesWorker(
    task: typeof schema.kanbanTasks.$inferSelect,
    project: typeof schema.projects.$inferSelect,
    pr: Awaited<ReturnType<typeof fetchPullRequest>>,
    reviews: Awaited<ReturnType<typeof fetchPullRequestReviews>>,
    reviewComments: Awaited<ReturnType<typeof fetchPullRequestReviewComments>>,
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    const feedbackParts: string[] = [];
    const changeRequestStates = ["CHANGES_REQUESTED", "REQUEST_CHANGES", "REJECTED"];

    const changeRequests = reviews.filter((r) => changeRequestStates.includes(r.state));
    for (const review of changeRequests) {
      feedbackParts.push(`Review by ${review.user.login} (${review.state}):\n${review.body || "(no body)"}`);
    }

    if (reviewComments.length > 0) {
      feedbackParts.push("\nInline review comments:");
      for (const c of reviewComments) {
        const location = c.line ? `${c.path}:${c.line}` : c.path;
        feedbackParts.push(`- ${c.user.login} on \`${location}\`:\n  ${c.body}\n  \`\`\`diff\n  ${c.diff_hunk?.slice(-200) ?? ""}\n  \`\`\``);
      }
    }

    const feedback = feedbackParts.join("\n\n");
    const branchName = task.prBranch || pr.head.ref;

    const reviewDescription =
      `[PR REVIEW CYCLE — PR #${task.prNumber} on branch \`${branchName}\`]\n\n` +
      `This task already has an open PR. A reviewer requested changes.\n` +
      `The worker must ONLY address the review feedback below — do NOT redo the original task.\n\n` +
      `--- REVIEW FEEDBACK ---\n${feedback}\n--- END FEEDBACK ---\n\n` +
      `Instructions: Check out branch \`${branchName}\`, make the requested fixes, commit, and push. ` +
      `Do NOT create a new branch or PR — pushing to this branch auto-updates the existing PR #${task.prNumber}.`;

    db.update(schema.kanbanTasks)
      .set({
        column: "in_progress",
        description: reviewDescription,
        assigneeAgentId: null,
        updatedAt: now,
      })
      .where(eq(schema.kanbanTasks.id, task.id))
      .run();

    const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
    if (updated) {
      this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
    }

    const teamLeads = this.coo.getTeamLeads();
    const teamLead = teamLeads.get(task.projectId);
    if (teamLead) {
      const bus = (this.coo as any).bus;
      if (bus) {
        const taskLabel = task.taskNumber ? `Issue #${task.taskNumber}` : task.id;
        bus.send({
          fromAgentId: "coo",
          toAgentId: teamLead.id,
          type: MessageType.Directive,
          content:
            `PR REVIEW FEEDBACK for existing task "${task.title}" (${taskLabel}) — this task is already in_progress on the kanban board.\n\n` +
            `IMPORTANT: Do NOT create any new tasks. Do NOT redo the original work. ` +
            `Spawn exactly ONE worker to address the review feedback on the EXISTING task (${task.id}). ` +
            `The task description already contains the review feedback and branch instructions.\n\n` +
            `Use update_task to assign the worker to task ${task.id}, then spawn_worker with the review feedback.\n\n` +
            `Review summary: PR #${task.prNumber} on branch \`${branchName}\` received changes-requested.\n` +
            `${feedback}`,
          projectId: task.projectId,
        });
      }
    }

    const prTaskLabel = task.taskNumber ? `Issue #${task.taskNumber} (${task.id})` : task.id;
    console.log(`[GiteaPRMonitor] Changes requested on PR #${task.prNumber} — sent directive for ${prTaskLabel}`);
  }
}
