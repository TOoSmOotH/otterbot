import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import type { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  KanbanTask,
  MergeQueueEntry,
  MergeQueueStatus,
} from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";
import {
  fetchPullRequest,
  mergePullRequest,
  createIssueComment,
  gitEnvWithPAT,
  gitCredentialArgs,
} from "../github/github-service.js";
import { rebaseBranch, forcePushBranch } from "../utils/git.js";
import { formatBotComment } from "../utils/github-comments.js";
import type { Scheduler } from "../schedulers/scheduler-registry.js";
import type { PipelineManager } from "../pipeline/pipeline-manager.js";
import type { WorkspaceManager } from "../workspace/workspace.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export class MergeQueue implements Scheduler {
  private io: TypedServer;
  private workspace: WorkspaceManager;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pipelineManager: PipelineManager | null = null;
  private processing = false;

  constructor(io: TypedServer, workspace: WorkspaceManager) {
    this.io = io;
    this.workspace = workspace;
  }

  setPipelineManager(pm: PipelineManager): void {
    this.pipelineManager = pm;
  }

  // ─── Scheduler interface ──────────────────────────────────────────

  start(intervalMs = 30_000): void {
    if (this.intervalId) return;
    this.recover();
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[MergeQueue] Poll error:", err);
      });
    }, intervalMs);
    console.log(`[MergeQueue] Started polling every ${intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Enqueue a task for merge. Creates a queued entry from an in_review task.
   */
  approveForMerge(taskId: string): MergeQueueEntry | null {
    const db = getDb();
    const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
    if (!task) return null;
    if (!task.prNumber || !task.prBranch) return null;

    // Check if already in queue
    const existing = db
      .select()
      .from(schema.mergeQueue)
      .where(eq(schema.mergeQueue.taskId, taskId))
      .get();
    if (existing) return existing as unknown as MergeQueueEntry;

    // Get project info for base branch
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get();
    const baseBranch = project?.githubBranch
      ?? getConfig(`project:${task.projectId}:github:branch`)
      ?? "main";

    // Determine position (append to end)
    const allEntries = db.select().from(schema.mergeQueue).all();
    const maxPosition = allEntries.reduce((max, e) => Math.max(max, e.position), 0);

    const now = new Date().toISOString();
    const entry = {
      id: nanoid(),
      taskId,
      projectId: task.projectId,
      prNumber: task.prNumber,
      prBranch: task.prBranch,
      baseBranch,
      status: "queued" as const,
      position: maxPosition + 1,
      rebaseAttempts: 0,
      lastError: null,
      approvedAt: now,
      mergedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.mergeQueue).values(entry).run();

    const result = entry as unknown as MergeQueueEntry;
    this.emitEntryUpdated(result);
    this.emitQueueUpdated();

    console.log(`[MergeQueue] Task ${taskId} (PR #${task.prNumber}) enqueued at position ${entry.position}`);
    return result;
  }

  /**
   * Remove a task from the merge queue. Task stays in in_review.
   */
  removeFromQueue(taskId: string): boolean {
    const db = getDb();
    const entry = db
      .select()
      .from(schema.mergeQueue)
      .where(eq(schema.mergeQueue.taskId, taskId))
      .get();
    if (!entry) return false;

    db.delete(schema.mergeQueue).where(eq(schema.mergeQueue.id, entry.id)).run();
    this.emitQueueUpdated();

    console.log(`[MergeQueue] Removed task ${taskId} from queue`);
    return true;
  }

  /**
   * Get all queue entries, ordered by position.
   */
  getQueue(projectId?: string): MergeQueueEntry[] {
    const db = getDb();
    let entries;
    if (projectId) {
      entries = db
        .select()
        .from(schema.mergeQueue)
        .where(eq(schema.mergeQueue.projectId, projectId))
        .all();
    } else {
      entries = db.select().from(schema.mergeQueue).all();
    }
    return (entries as unknown as MergeQueueEntry[]).sort((a, b) => a.position - b.position);
  }

  /**
   * Check if a task is in the merge queue.
   */
  isInQueue(taskId: string): boolean {
    const db = getDb();
    const entry = db
      .select()
      .from(schema.mergeQueue)
      .where(eq(schema.mergeQueue.taskId, taskId))
      .get();
    return !!entry;
  }

  /**
   * Reorder an entry to a new position.
   */
  reorderEntry(entryId: string, newPosition: number): boolean {
    const db = getDb();
    const entry = db.select().from(schema.mergeQueue).where(eq(schema.mergeQueue.id, entryId)).get();
    if (!entry) return false;

    const now = new Date().toISOString();
    db.update(schema.mergeQueue)
      .set({ position: newPosition, updatedAt: now })
      .where(eq(schema.mergeQueue.id, entryId))
      .run();

    this.emitQueueUpdated();
    return true;
  }

  /**
   * Called by PipelineManager when re-review completes.
   */
  async onReReviewComplete(taskId: string, passed: boolean): Promise<void> {
    const db = getDb();
    const entry = db
      .select()
      .from(schema.mergeQueue)
      .where(eq(schema.mergeQueue.taskId, taskId))
      .get();
    if (!entry) return;

    if (passed) {
      // Re-review passed — proceed to merge
      await this.updateEntryStatus(entry.id, "merging");
      await this.doMerge(entry.id);
    } else {
      // Re-review failed — mark as failed
      await this.updateEntryStatus(entry.id, "failed", "Re-review failed after rebase");

      // Move task back to in_review
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({ column: "in_review", updatedAt: now })
        .where(eq(schema.kanbanTasks.id, taskId))
        .run();
      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, taskId)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────

  /**
   * Recovery on server restart: reset transient states.
   */
  private recover(): void {
    const db = getDb();
    const now = new Date().toISOString();

    // Reset rebasing → queued (rebase state is lost)
    db.update(schema.mergeQueue)
      .set({ status: "queued", updatedAt: now })
      .where(eq(schema.mergeQueue.status, "rebasing"))
      .run();

    // Reset re_review → queued (pipeline state is in-memory)
    db.update(schema.mergeQueue)
      .set({ status: "queued", updatedAt: now })
      .where(eq(schema.mergeQueue.status, "re_review"))
      .run();

    // For merging entries, we'll check PR status in the next poll

    const recovered = db.select().from(schema.mergeQueue).all();
    if (recovered.length > 0) {
      console.log(`[MergeQueue] Recovered ${recovered.length} queue entries`);
    }
  }

  /**
   * Main poll loop: sync state and process next entry.
   */
  private async poll(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      await this.syncExternalState();
      await this.processNext();
    } finally {
      this.processing = false;
    }
  }

  /**
   * Check GitHub for PRs that were merged/closed externally.
   */
  private async syncExternalState(): Promise<void> {
    const token = getConfig("github:token");
    if (!token) return;

    const db = getDb();
    const activeEntries = db
      .select()
      .from(schema.mergeQueue)
      .all()
      .filter((e) => !["merged", "failed"].includes(e.status));

    for (const entry of activeEntries) {
      try {
        const project = db.select().from(schema.projects).where(eq(schema.projects.id, entry.projectId)).get();
        if (!project?.githubRepo) continue;

        const pr = await fetchPullRequest(project.githubRepo, token, entry.prNumber);

        if (pr.merged) {
          // Merged externally — mark as merged, move task to done
          await this.updateEntryStatus(entry.id, "merged");
          const now = new Date().toISOString();
          db.update(schema.mergeQueue)
            .set({ mergedAt: now, updatedAt: now })
            .where(eq(schema.mergeQueue.id, entry.id))
            .run();

          db.update(schema.kanbanTasks)
            .set({
              column: "done",
              completionReport: `PR #${entry.prNumber} merged (detected by merge queue).`,
              updatedAt: now,
            })
            .where(eq(schema.kanbanTasks.id, entry.taskId))
            .run();

          const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, entry.taskId)).get();
          if (updated) {
            this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
          }

          console.log(`[MergeQueue] PR #${entry.prNumber} merged externally — task ${entry.taskId} → done`);
        } else if (pr.state === "closed") {
          // Closed without merge — remove from queue, task → backlog
          db.delete(schema.mergeQueue).where(eq(schema.mergeQueue.id, entry.id)).run();

          const now = new Date().toISOString();
          db.update(schema.kanbanTasks)
            .set({ column: "backlog", assigneeAgentId: null, updatedAt: now })
            .where(eq(schema.kanbanTasks.id, entry.taskId))
            .run();

          const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, entry.taskId)).get();
          if (updated) {
            this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
          }

          this.emitQueueUpdated();
          console.log(`[MergeQueue] PR #${entry.prNumber} closed — task ${entry.taskId} → backlog`);
        }
      } catch (err) {
        console.error(`[MergeQueue] Error syncing PR #${entry.prNumber}:`, err);
      }
    }
  }

  /**
   * Process the next queued entry if nothing is currently being processed.
   */
  private async processNext(): Promise<void> {
    const db = getDb();
    const activeEntries = db
      .select()
      .from(schema.mergeQueue)
      .all()
      .filter((e) => ["rebasing", "re_review", "merging"].includes(e.status));

    // Don't process if something is actively being worked on
    if (activeEntries.length > 0) return;

    // Find next queued entry
    const queued = db
      .select()
      .from(schema.mergeQueue)
      .where(eq(schema.mergeQueue.status, "queued"))
      .all()
      .sort((a, b) => a.position - b.position);

    if (queued.length === 0) return;

    const next = queued[0];
    await this.processEntry(next.id);
  }

  /**
   * Process a single queue entry: rebase → re-review → merge.
   */
  private async processEntry(entryId: string): Promise<void> {
    const db = getDb();
    const entry = db.select().from(schema.mergeQueue).where(eq(schema.mergeQueue.id, entryId)).get();
    if (!entry) return;

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, entry.projectId)).get();
    if (!project?.githubRepo) return;

    const token = getConfig("github:token");
    if (!token) return;

    // Step 1: Rebase
    await this.updateEntryStatus(entryId, "rebasing");

    const repoPath = this.workspace.repoPath(entry.projectId);
    const gitEnv = gitEnvWithPAT(token);
    const credArgs = gitCredentialArgs();

    const rebaseSuccess = rebaseBranch(
      repoPath,
      entry.prBranch,
      entry.baseBranch,
      gitEnv,
      credArgs,
    );

    if (!rebaseSuccess) {
      // Rebase conflict
      await this.updateEntryStatus(entryId, "conflict", "Rebase conflict with base branch");

      // Post comment on PR
      try {
        await createIssueComment(
          project.githubRepo,
          token,
          entry.prNumber,
          formatBotComment(
            "Merge Queue: Rebase Conflict",
            `Could not automatically rebase \`${entry.prBranch}\` onto \`${entry.baseBranch}\`. ` +
            `Please resolve the conflicts manually and re-approve for merge.`,
          ),
        );
      } catch { /* best effort */ }

      // Move task to backlog for attention
      const now = new Date().toISOString();
      db.update(schema.kanbanTasks)
        .set({ column: "backlog", assigneeAgentId: null, updatedAt: now })
        .where(eq(schema.kanbanTasks.id, entry.taskId))
        .run();
      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, entry.taskId)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      console.log(`[MergeQueue] Rebase conflict for PR #${entry.prNumber}`);
      return;
    }

    // Force push the rebased branch
    try {
      forcePushBranch(repoPath, entry.prBranch, gitEnv, credArgs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.updateEntryStatus(entryId, "failed", `Force push failed: ${msg}`);
      console.error(`[MergeQueue] Force push failed for PR #${entry.prNumber}:`, err);
      return;
    }

    // Step 2: Re-review via pipeline (if pipeline is enabled)
    if (this.pipelineManager?.isEnabled(entry.projectId)) {
      await this.updateEntryStatus(entryId, "re_review");
      try {
        await this.pipelineManager.startReReview(entry.taskId, entry.prBranch, entry.prNumber);
        // Pipeline will call onReReviewComplete when done
        console.log(`[MergeQueue] Started re-review for PR #${entry.prNumber}`);
        return;
      } catch (err) {
        console.error(`[MergeQueue] Failed to start re-review for PR #${entry.prNumber}:`, err);
        // Fall through to merge without re-review
      }
    }

    // Step 3: Merge (if no pipeline, or pipeline start failed)
    await this.updateEntryStatus(entryId, "merging");
    await this.doMerge(entryId);
  }

  /**
   * Perform the actual merge via GitHub API.
   */
  private async doMerge(entryId: string): Promise<void> {
    const db = getDb();
    const entry = db.select().from(schema.mergeQueue).where(eq(schema.mergeQueue.id, entryId)).get();
    if (!entry) return;

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, entry.projectId)).get();
    if (!project?.githubRepo) return;

    const token = getConfig("github:token");
    if (!token) return;

    const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, entry.taskId)).get();

    try {
      const commitTitle = task
        ? `${task.title} (#${entry.prNumber})`
        : `PR #${entry.prNumber}`;

      await mergePullRequest(
        project.githubRepo,
        token,
        entry.prNumber,
        "squash",
        commitTitle,
      );

      // Mark as merged
      const now = new Date().toISOString();
      db.update(schema.mergeQueue)
        .set({ status: "merged", mergedAt: now, updatedAt: now })
        .where(eq(schema.mergeQueue.id, entryId))
        .run();

      // Move task to done
      db.update(schema.kanbanTasks)
        .set({
          column: "done",
          completionReport: `PR #${entry.prNumber} merged via merge queue.`,
          updatedAt: now,
        })
        .where(eq(schema.kanbanTasks.id, entry.taskId))
        .run();

      const updated = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, entry.taskId)).get();
      if (updated) {
        this.io.emit("kanban:task-updated", updated as unknown as KanbanTask);
      }

      this.emitEntryUpdated(this.getEntry(entryId)!);
      this.emitQueueUpdated();

      console.log(`[MergeQueue] PR #${entry.prNumber} merged successfully`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Check if it's a rate limit or temporary error — keep in merging for retry
      if (msg.includes("405") || msg.includes("409")) {
        // 405 = not mergeable, 409 = conflict
        await this.updateEntryStatus(entryId, "failed", `Merge failed: ${msg}`);
      } else {
        // Retry on next poll cycle
        console.error(`[MergeQueue] Merge API error for PR #${entry.prNumber}: ${msg}`);
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async updateEntryStatus(
    entryId: string,
    status: MergeQueueStatus,
    error?: string,
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status, updatedAt: now };
    if (error !== undefined) updates.lastError = error;
    if (status === "rebasing") {
      // Increment rebase attempts
      const entry = db.select().from(schema.mergeQueue).where(eq(schema.mergeQueue.id, entryId)).get();
      if (entry) updates.rebaseAttempts = entry.rebaseAttempts + 1;
    }

    db.update(schema.mergeQueue)
      .set(updates)
      .where(eq(schema.mergeQueue.id, entryId))
      .run();

    const updated = this.getEntry(entryId);
    if (updated) this.emitEntryUpdated(updated);
  }

  private getEntry(entryId: string): MergeQueueEntry | null {
    const db = getDb();
    const entry = db.select().from(schema.mergeQueue).where(eq(schema.mergeQueue.id, entryId)).get();
    return (entry as unknown as MergeQueueEntry) ?? null;
  }

  private emitEntryUpdated(entry: MergeQueueEntry): void {
    this.io.emit("merge-queue:entry-updated", entry);
  }

  private emitQueueUpdated(): void {
    const entries = this.getQueue();
    this.io.emit("merge-queue:updated", { entries });
  }
}
