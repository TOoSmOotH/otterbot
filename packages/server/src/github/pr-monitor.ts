import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, KanbanTask } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";
import {
  fetchPullRequest,
  fetchPullRequestReviews,
  fetchPullRequestReviewComments,
} from "./github-service.js";
import type { COO } from "../agents/coo.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class GitHubPRMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private coo: COO;
  private io: TypedServer;
  /** Track processed review IDs to avoid re-triggering on the same review */
  private processedReviewIds = new Set<number>();

  constructor(coo: COO, io: TypedServer) {
    this.coo = coo;
    this.io = io;
  }

  /** Start the polling loop */
  start(pollIntervalMs = 120_000): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[PRMonitor] Poll error:", err);
      });
    }, pollIntervalMs);
    console.log(`[PRMonitor] Started polling every ${pollIntervalMs / 1000}s`);
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    const token = getConfig("github:token");
    if (!token) return;

    const db = getDb();
    // Find all tasks in "in_review" with a prNumber set
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .all()
      .filter((t) => t.column === "in_review" && t.prNumber != null);

    for (const task of tasks) {
      try {
        await this.checkPR(task, token);
      } catch (err) {
        console.error(`[PRMonitor] Error checking PR #${task.prNumber} for task ${task.id}:`, err);
      }
    }
  }

  private async checkPR(
    task: typeof schema.kanbanTasks.$inferSelect,
    token: string,
  ): Promise<void> {
    const db = getDb();

    // Look up project to get githubRepo
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, task.projectId))
      .get();

    if (!project?.githubRepo || !task.prNumber) return;

    const pr = await fetchPullRequest(project.githubRepo, token, task.prNumber);

    if (pr.merged) {
      // PR merged → move task to done
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({
          column: "done",
          completionReport: `PR #${task.prNumber} merged successfully.`,
          updatedAt: now,
        })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();

      // Clean up tracked review IDs for this task
      this.cleanupReviewIds(task.prNumber);

      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      console.log(`[PRMonitor] PR #${task.prNumber} merged — task ${task.id} → done`);
      return;
    }

    if (pr.state === "closed") {
      // PR closed without merging → move task to backlog for retry
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({
          column: "backlog",
          assigneeAgentId: null,
          updatedAt: now,
        })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();

      // Clean up tracked review IDs for this task
      this.cleanupReviewIds(task.prNumber);

      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, task.id)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      console.log(`[PRMonitor] PR #${task.prNumber} closed (not merged) — task ${task.id} → backlog`);
      return;
    }

    // PR is still open — check for changes requested
    const reviews = await fetchPullRequestReviews(project.githubRepo, token, task.prNumber);

    // Find new CHANGES_REQUESTED reviews that we haven't processed
    const newChangeRequests = reviews.filter(
      (r) => r.state === "CHANGES_REQUESTED" && !this.processedReviewIds.has(r.id),
    );

    if (newChangeRequests.length === 0) return;

    // Mark all new reviews as processed
    for (const r of newChangeRequests) {
      this.processedReviewIds.add(r.id);
    }

    // Also mark any other review IDs we see to avoid processing them later
    for (const r of reviews) {
      this.processedReviewIds.add(r.id);
    }

    // Fetch inline review comments for additional context
    const reviewComments = await fetchPullRequestReviewComments(
      project.githubRepo,
      token,
      task.prNumber,
    );

    await this.requestChangesWorker(task, project, pr, reviews, reviewComments);
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

    // Build feedback string from reviews
    const feedbackParts: string[] = [];

    const changeRequests = reviews.filter((r) => r.state === "CHANGES_REQUESTED");
    for (const review of changeRequests) {
      feedbackParts.push(`Review by ${review.user.login} (CHANGES_REQUESTED):\n${review.body || "(no body)"}`);
    }

    // Add inline comments
    if (reviewComments.length > 0) {
      feedbackParts.push("\nInline review comments:");
      for (const c of reviewComments) {
        const location = c.line ? `${c.path}:${c.line}` : c.path;
        feedbackParts.push(`- ${c.user.login} on \`${location}\`:\n  ${c.body}\n  \`\`\`diff\n  ${c.diff_hunk.slice(-200)}\n  \`\`\``);
      }
    }

    const feedback = feedbackParts.join("\n\n");

    // Determine branch name — prefer stored prBranch, fallback to PR API
    const branchName = task.prBranch || pr.head.ref;

    // Replace the task description with review-cycle context so the TeamLead
    // does NOT re-read the original description and redo the entire task.
    const reviewDescription =
      `[PR REVIEW CYCLE — PR #${task.prNumber} on branch \`${branchName}\`]\n\n` +
      `This task already has an open PR. A reviewer requested changes.\n` +
      `The worker must ONLY address the review feedback below — do NOT redo the original task.\n\n` +
      `--- REVIEW FEEDBACK ---\n${feedback}\n--- END FEEDBACK ---\n\n` +
      `Instructions: Check out branch \`${branchName}\`, make the requested fixes, commit, and push. ` +
      `Do NOT create a new branch or PR — pushing to this branch auto-updates the existing PR #${task.prNumber}.`;

    // Move task to in_progress with updated description and clear assignee
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

    // Send directive to TeamLead — explicitly reference the existing task
    // so it spawns exactly one worker for that task, not a new one.
    const teamLeads = this.coo.getTeamLeads();
    const teamLead = teamLeads.get(task.projectId);
    if (teamLead) {
      const bus = (this.coo as any).bus;
      if (bus) {
        bus.send({
          fromAgentId: "coo",
          toAgentId: teamLead.id,
          type: MessageType.Directive,
          content:
            `PR REVIEW FEEDBACK for existing task "${task.title}" (${task.id}) — this task is already in_progress on the kanban board.\n\n` +
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

    console.log(`[PRMonitor] Changes requested on PR #${task.prNumber} — sent directive for task ${task.id}`);
  }

  /** Remove tracked review IDs for a given PR when it leaves in_review */
  private cleanupReviewIds(prNumber: number): void {
    // We don't have a direct mapping of PR→review IDs, so we just leave them.
    // The set is bounded by the number of reviews seen during this process lifetime.
    // A more sophisticated approach would track per-PR, but this is sufficient.
    void prNumber;
  }
}
