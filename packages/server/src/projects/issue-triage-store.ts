import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/** The current triage state for one issue: the latest plan + comment high-water mark. */
export interface TriageState {
  plan: string;
  lastCommentId: number;
}

/**
 * Per-issue triage state (one row per project+issue). Stores the PM's current
 * candidate plan and `lastCommentId` — the highest forge comment id processed, so
 * the poller reacts only to newer comments.
 */
export class IssueTriageStore {
  constructor(private readonly control: ControlDb) {}

  get(projectId: string, issueNumber: number): TriageState | null {
    const row = this.control.db
      .select({
        plan: controlSchema.issueTriage.plan,
        lastCommentId: controlSchema.issueTriage.lastCommentId,
      })
      .from(controlSchema.issueTriage)
      .where(
        and(
          eq(controlSchema.issueTriage.projectId, projectId),
          eq(controlSchema.issueTriage.issueNumber, issueNumber)
        )
      )
      .get();
    return row ?? null;
  }

  /** Insert or replace the plan + watermark for an issue. */
  upsert(projectId: string, issueNumber: number, plan: string, lastCommentId: number): void {
    const now = new Date().toISOString();
    this.control.db
      .insert(controlSchema.issueTriage)
      .values({ id: nanoid(), projectId, issueNumber, plan, lastCommentId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [controlSchema.issueTriage.projectId, controlSchema.issueTriage.issueNumber],
        set: { plan, lastCommentId, updatedAt: now },
      })
      .run();
  }

  /** Advance only the comment high-water mark (no plan change). */
  advanceWatermark(projectId: string, issueNumber: number, lastCommentId: number): void {
    this.control.db
      .update(controlSchema.issueTriage)
      .set({ lastCommentId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(controlSchema.issueTriage.projectId, projectId),
          eq(controlSchema.issueTriage.issueNumber, issueNumber)
        )
      )
      .run();
  }
}
