import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { parseVerdict } from "./pipeline-manager.js";

export type TaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "awaiting_merge"
  | "merging"
  | "merged"
  | "conflict"
  | "failed";

export type TaskRole =
  | "coder"
  | "integrator"
  | "security-reviewer"
  | "test-writer"
  | "tester";

/** Roles whose VERDICT can fail the run and kick the work back. */
export const GATE_ROLES = new Set<TaskRole>(["security-reviewer", "tester"]);

/** Max times a task is kicked back before its run is marked failed. */
export const DEFAULT_MAX_ATTEMPTS = 2;

export interface BuildTask {
  id: string;
  runId: string;
  projectId: string;
  title: string;
  description: string;
  role: TaskRole;
  deps: string[];
  status: TaskStatus;
  assignedAgentId: string | null;
  branch: string | null;
  worktreePath: string | null;
  attempt: number;
  filesHint: string[] | null;
  report: string;
  transcriptRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "integrating"
  | "reviewing"
  | "done"
  | "failed"
  | "aborted";

export interface BuildRun {
  id: string;
  projectId: string;
  goal: string;
  status: RunStatus;
  integrationBranch: string | null;
  parallelism: number;
  prNumber: number | null;
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildRunView extends BuildRun {
  tasks: BuildTask[];
}

/**
 * Tasks eligible to run now: not yet started (`blocked`/`ready`) and every
 * dependency `merged`. Pure — the scheduler's core selection logic.
 */
export function readyTasks(tasks: BuildTask[]): BuildTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const merged = (id: string) => byId.get(id)?.status === "merged";
  return tasks.filter(
    (t) => (t.status === "blocked" || t.status === "ready") && t.deps.every(merged)
  );
}

export { parseVerdict };

export interface RunTaskArgs {
  run: BuildRun;
  task: BuildTask;
  priorReports: Array<{ taskId: string; title: string; report: string }>;
}

export interface BuildGraphDeps {
  control: ControlDb;
  /** Execute one task; returns its report (+ optional explicit pass verdict). */
  runTask: (args: RunTaskArgs) => Promise<{ report: string; pass?: boolean }>;
  /** Notified after each state change (sockets/UI). Optional. */
  onUpdate?: (view: BuildRunView) => void;
  /** Kickback bound; defaults to DEFAULT_MAX_ATTEMPTS. */
  maxAttempts?: number;
}

export interface TaskSpec {
  id: string;
  title: string;
  description?: string;
  role: TaskRole;
  deps?: string[];
  filesHint?: string[];
}

type TaskRow = typeof controlSchema.tasks.$inferSelect;
type RunRow = typeof controlSchema.buildRuns.$inferSelect;

export class BuildGraphManager {
  private readonly maxAttempts: number;
  constructor(private readonly deps: BuildGraphDeps) {
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** Create a run in the `running` state, ready to be seeded and started. */
  createRun(projectId: string, goal: string, opts: { parallelism?: number } = {}): string {
    const id = nanoid();
    const now = new Date().toISOString();
    this.deps.control.db
      .insert(controlSchema.buildRuns)
      .values({
        id,
        projectId,
        goal,
        status: "running",
        parallelism: opts.parallelism ?? 3,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.emit(id);
    return id;
  }

  /** Insert task nodes for a run (status `blocked`). Caller supplies stable ids. */
  seedTasks(runId: string, projectId: string, specs: TaskSpec[]): void {
    const now = new Date().toISOString();
    for (const s of specs) {
      this.deps.control.db
        .insert(controlSchema.tasks)
        .values({
          id: s.id,
          runId,
          projectId,
          title: s.title,
          description: s.description ?? "",
          role: s.role,
          deps: JSON.stringify(s.deps ?? []),
          status: "blocked",
          filesHint: s.filesHint ? JSON.stringify(s.filesHint) : null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    this.emit(runId);
  }

  // --- reads ---------------------------------------------------------------

  getRun(runId: string): BuildRun | null {
    const row = this.deps.control.db
      .select()
      .from(controlSchema.buildRuns)
      .where(eq(controlSchema.buildRuns.id, runId))
      .get() as RunRow | undefined;
    return row ? (row as BuildRun) : null;
  }

  listTasks(runId: string): BuildTask[] {
    const rows = this.deps.control.db
      .select()
      .from(controlSchema.tasks)
      .where(eq(controlSchema.tasks.runId, runId))
      .all() as TaskRow[];
    return rows.map((r) => this.toTask(r));
  }

  view(runId: string): BuildRunView | null {
    const run = this.getRun(runId);
    if (!run) return null;
    return { ...run, tasks: this.listTasks(runId) };
  }

  private toTask(r: TaskRow): BuildTask {
    return {
      ...r,
      role: r.role as TaskRole,
      status: r.status as TaskStatus,
      deps: JSON.parse(r.deps || "[]") as string[],
      filesHint: r.filesHint ? (JSON.parse(r.filesHint) as string[]) : null,
    };
  }

  private emit(runId: string): void {
    if (!this.deps.onUpdate) return;
    const v = this.view(runId);
    if (v) this.deps.onUpdate(v);
  }
}
