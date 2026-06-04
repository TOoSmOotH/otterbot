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

/** All task ids reachable through `deps` from `startId` (excludes startId). */
export function transitiveDepIds(startId: string, tasks: BuildTask[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [...(byId.get(startId)?.deps ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.deps ?? []) stack.push(d);
  }
  return [...seen];
}

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
      .get() as BuildRun | undefined;
    return row ?? null;
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

  /** Start driving a run's graph in the background. */
  start(runId: string): void {
    void this.drive(runId).catch((err) => {
      console.error(`[build-graph] run ${runId} crashed:`, err);
      this.finishRun(runId, "failed");
    });
  }

  private async drive(runId: string): Promise<void> {
    // Worker pool: dispatch up to `run.parallelism` dependency-ready tasks at
    // once, then await the next completion. A run only fails as "stuck" when
    // nothing is ready AND nothing is in flight — an in-flight task with no
    // other ready work means wait, not fail.
    type Settled = {
      taskId: string;
      role: TaskRole;
      outcome: { report: string; pass?: boolean } | null;
      error: Error | null;
    };
    const inFlight = new Map<string, Promise<Settled>>();

    const launch = (run: BuildRun, task: BuildTask, snapshot: BuildTask[]): void => {
      this.setTaskStatus(runId, task.id, "running");
      const priorReports = snapshot
        .filter((t) => t.status === "merged")
        .map((t) => ({ taskId: t.id, title: t.title, report: t.report }));
      const p: Promise<Settled> = this.deps
        .runTask({ run, task, priorReports })
        .then((outcome) => ({ taskId: task.id, role: task.role, outcome, error: null }))
        .catch((err) => ({
          taskId: task.id,
          role: task.role,
          outcome: null,
          error: err instanceof Error ? err : new Error(String(err)),
        }));
      inFlight.set(task.id, p);
    };

    for (;;) {
      const run = this.getRun(runId);
      if (!run || run.status !== "running") return; // aborted / gone
      const tasks = this.listTasks(runId);

      if (inFlight.size === 0 && tasks.length > 0 && tasks.every((t) => t.status === "merged")) {
        this.finishRun(runId, "done");
        return;
      }

      const capacity = run.parallelism - inFlight.size;
      if (capacity > 0) {
        // Skip tasks already in flight: a concurrent kickback can reset an
        // in-flight task's transitive dep back to `blocked` while it is still
        // running; never launch a second concurrent run for the same id.
        const dispatchable = readyTasks(tasks).filter((t) => !inFlight.has(t.id));
        for (const task of dispatchable.slice(0, capacity)) launch(run, task, tasks);
      }

      if (inFlight.size === 0) {
        // Nothing running and nothing became ready → the graph is stuck.
        this.finishRun(runId, "failed");
        return;
      }

      const settled = await Promise.race(inFlight.values());
      inFlight.delete(settled.taskId);

      // If a concurrent kickback reset this task while it was running, its result
      // is stale — drop it and let the task be re-dispatched fresh.
      const current = this.listTasks(runId).find((t) => t.id === settled.taskId);
      if (current && current.status !== "running") continue;

      // Resolve the completion to pass/fail. A thrown error counts as a failure.
      let pass: boolean;
      if (settled.error) {
        this.setTaskReport(runId, settled.taskId, settled.error.message);
        pass = false;
      } else {
        const outcome = settled.outcome!;
        this.setTaskReport(runId, settled.taskId, outcome.report);
        pass = outcome.pass ?? parseVerdict(outcome.report);
      }

      if (pass) {
        this.setTaskStatus(runId, settled.taskId, "merged");
        continue;
      }

      // Any failure — thrown error, explicit pass:false, or a gate VERDICT: FAIL —
      // kicks the task back (reset + bounded retry). The run fails only when the
      // task's retry budget (maxAttempts) is exhausted.
      if (!this.handleKickback(runId, settled.taskId)) {
        this.setTaskStatus(runId, settled.taskId, "failed");
        this.finishRun(runId, "failed");
        return;
      }
      continue;
    }
  }

  // --- state mutation ------------------------------------------------------

  private setTaskStatus(runId: string, taskId: string, status: TaskStatus): void {
    this.deps.control.db
      .update(controlSchema.tasks)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.tasks.id, taskId))
      .run();
    this.emit(runId);
  }

  private setTaskReport(runId: string, taskId: string, report: string): void {
    this.deps.control.db
      .update(controlSchema.tasks)
      .set({ report, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.tasks.id, taskId))
      .run();
    this.emit(runId);
  }

  private setTaskAttempt(runId: string, taskId: string, attempt: number): void {
    this.deps.control.db
      .update(controlSchema.tasks)
      .set({ attempt, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.tasks.id, taskId))
      .run();
    this.emit(runId);
  }

  private finishRun(runId: string, status: RunStatus): void {
    this.deps.control.db
      .update(controlSchema.buildRuns)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(controlSchema.buildRuns.id, runId))
      .run();
    this.emit(runId);
  }

  /**
   * A gate task failed: bump its attempt, and if still within budget reset the
   * task and all its transitive dependencies to `blocked` so the work re-runs.
   * Returns false when the attempt budget is exhausted (caller fails the run).
   */
  private handleKickback(runId: string, taskId: string): boolean {
    const tasks = this.listTasks(runId);
    const failed = tasks.find((t) => t.id === taskId);
    if (!failed) return false;
    const nextAttempt = failed.attempt + 1;
    if (nextAttempt > this.maxAttempts) return false;

    const reset = new Set<string>([taskId, ...transitiveDepIds(taskId, tasks)]);
    for (const id of reset) this.setTaskStatus(runId, id, "blocked");
    this.setTaskAttempt(runId, taskId, nextAttempt);
    return true;
  }
}
