# Build Graph — Phase 1: Data Model & Scheduler Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistent task-graph data model and a single-worker graph scheduler that drives a DAG of build tasks to completion, with dependency-aware readiness, gate kickback, and bounded retries — the foundation the parallel worker pool (Phase 2) and UI/observability (Phase 3) build on.

**Architecture:** A new `BuildGraphManager` mirrors the existing `PipelineManager`: it persists a run and its task nodes to `control.db`, then `drive()`s the graph in the background — repeatedly selecting dependency-ready tasks, executing each via an injected `runTask` callback, and advancing task/run state. Execution is decoupled from the bus (a callback, like `PipelineManager.runStage`) so the whole engine is unit-testable against a fake. Phase 1 runs ready tasks **one at a time** (single worker); the worker pool and worktree isolation arrive in Phase 2. A simple linear graph (coder → reviewer → tester) reproduces today's pipeline as the degenerate case.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Drizzle ORM over better-sqlite3, Vitest. Follows the patterns in `packages/server/src/pipeline/pipeline-manager.ts` and its test.

**Scope boundary (read first):** Phase 1 delivers the data model + scheduler engine as a self-contained, fully unit-tested library unit. It does **not** wire into the orchestrator, bus, PM tools, git worktrees, or UI — those are Phases 2 and 3. Terminal success for a task is the status `merged` (a task is "incorporated into the run"); the spec's "merged/done" wording collapses to `merged` at the task level, while `done` remains a *run* status.

---

### Task 1: Add `build_runs` and `tasks` tables

**Files:**
- Modify: `packages/server/src/db/control-schema.ts` (append after `pipelineStageResults`, ~line 373)
- Modify: `packages/server/src/db/control-db.ts` (add DDL to the `stmts` array, after the `pipeline_stage_results` block ~line 219)
- Test: `packages/server/src/db/build-graph-schema.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/db/build-graph-schema.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openControlDb, controlSchema, type ControlDb } from "./control-db.js";

describe("build_runs / tasks schema", () => {
  let dir: string;
  let control: ControlDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bg-schema-"));
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a build run and a task row", () => {
    const now = new Date().toISOString();
    control.db
      .insert(controlSchema.buildRuns)
      .values({ id: "run1", projectId: "proj1", goal: "build it", createdAt: now, updatedAt: now })
      .run();
    control.db
      .insert(controlSchema.tasks)
      .values({
        id: "t1",
        runId: "run1",
        projectId: "proj1",
        title: "implement X",
        role: "coder",
        deps: "[]",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const run = control.db
      .select()
      .from(controlSchema.buildRuns)
      .where(eq(controlSchema.buildRuns.id, "run1"))
      .get();
    const task = control.db
      .select()
      .from(controlSchema.tasks)
      .where(eq(controlSchema.tasks.id, "t1"))
      .get();

    expect(run?.status).toBe("planning"); // default
    expect(run?.parallelism).toBe(3); // default
    expect(task?.status).toBe("blocked"); // default
    expect(task?.attempt).toBe(0);
    expect(task?.deps).toBe("[]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test build-graph-schema`
Expected: FAIL — `controlSchema.buildRuns` is undefined (and/or `no such table: build_runs`).

- [ ] **Step 3: Add the Drizzle table definitions**

In `packages/server/src/db/control-schema.ts`, append after the `pipelineStageResults` table (after ~line 373):

```typescript
/**
 * One run of a project's build graph — the Phase-1 generalization of
 * `pipeline_runs`. The PM decomposes a goal into `tasks` (a DAG); the
 * `BuildGraphManager` drives them. A project may have several concurrent runs.
 */
export const buildRuns = sqliteTable("build_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: [
      "planning",
      "awaiting_approval",
      "running",
      "integrating",
      "reviewing",
      "done",
      "failed",
      "aborted",
    ],
  })
    .notNull()
    .default("planning"),
  /** Branch the integrator merges task branches onto (set in Phase 2). */
  integrationBranch: text("integration_branch"),
  /** Max coding tasks dispatched in parallel (worker pool size; Phase 2). */
  parallelism: integer("parallelism").notNull().default(3),
  prNumber: integer("pr_number"),
  prUrl: text("pr_url"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** One node of a build run's task graph. `deps`/`files_hint` are JSON arrays. */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /** coder | integrator | security-reviewer | test-writer | tester */
  role: text("role").notNull(),
  /** JSON array of task ids this task depends on. */
  deps: text("deps").notNull().default("[]"),
  /** blocked | ready | running | awaiting_merge | merging | merged | conflict | failed */
  status: text("status").notNull().default("blocked"),
  assignedAgentId: text("assigned_agent_id"),
  branch: text("branch"),
  worktreePath: text("worktree_path"),
  attempt: integer("attempt").notNull().default(0),
  /** JSON array of file globs this task is expected to touch, or null. */
  filesHint: text("files_hint"),
  report: text("report").notNull().default(""),
  /** Pointer to the flushed worker transcript (Phase 3). */
  transcriptRef: text("transcript_ref"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

- [ ] **Step 4: Add the raw DDL so the tables are created**

In `packages/server/src/db/control-db.ts`, inside the `stmts` array, immediately after the `idx_pipeline_stage_run` index statement (~line 219) and before the `issue_triage` block:

```typescript
    `CREATE TABLE IF NOT EXISTS build_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      integration_branch TEXT,
      parallelism INTEGER NOT NULL DEFAULT 3,
      pr_number INTEGER,
      pr_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_build_runs_project ON build_runs(project_id)`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      deps TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'blocked',
      assigned_agent_id TEXT,
      branch TEXT,
      worktree_path TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      files_hint TEXT,
      report TEXT NOT NULL DEFAULT '',
      transcript_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id)`,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test build-graph-schema`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/control-schema.ts packages/server/src/db/control-db.ts packages/server/src/db/build-graph-schema.test.ts
git commit -m "feat(build-graph): add build_runs and tasks tables"
```

---

### Task 2: `readyTasks` readiness function + domain types

**Files:**
- Create: `packages/server/src/pipeline/build-graph.ts`
- Test: `packages/server/src/pipeline/build-graph.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/pipeline/build-graph.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readyTasks, type BuildTask } from "./build-graph.js";

const task = (over: Partial<BuildTask> & Pick<BuildTask, "id">): BuildTask => ({
  id: over.id,
  runId: "run1",
  projectId: "proj1",
  title: over.title ?? over.id,
  description: "",
  role: over.role ?? "coder",
  deps: over.deps ?? [],
  status: over.status ?? "blocked",
  assignedAgentId: null,
  branch: null,
  worktreePath: null,
  attempt: over.attempt ?? 0,
  filesHint: null,
  report: "",
  transcriptRef: null,
  createdAt: "t",
  updatedAt: "t",
});

describe("readyTasks", () => {
  it("returns tasks with no deps that haven't started", () => {
    const ts = [task({ id: "a" }), task({ id: "b", status: "running" })];
    expect(readyTasks(ts).map((t) => t.id)).toEqual(["a"]);
  });

  it("holds a task until every dependency is merged", () => {
    const ts = [
      task({ id: "a", status: "merged" }),
      task({ id: "b", status: "running" }),
      task({ id: "c", deps: ["a", "b"] }),
    ];
    expect(readyTasks(ts).map((t) => t.id)).toEqual([]); // b not merged yet
  });

  it("releases a fan-in task once all deps merged", () => {
    const ts = [
      task({ id: "a", status: "merged" }),
      task({ id: "b", status: "merged" }),
      task({ id: "c", deps: ["a", "b"] }),
    ];
    expect(readyTasks(ts).map((t) => t.id)).toEqual(["c"]);
  });

  it("excludes already-merged and failed tasks", () => {
    const ts = [task({ id: "a", status: "merged" }), task({ id: "b", status: "failed" })];
    expect(readyTasks(ts)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test build-graph.test`
Expected: FAIL — cannot find module `./build-graph.js` / `readyTasks` not exported.

- [ ] **Step 3: Create the types and `readyTasks`**

Create `packages/server/src/pipeline/build-graph.ts`:

```typescript
import { eq } from "drizzle-orm";
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test build-graph.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph.test.ts
git commit -m "feat(build-graph): readiness function and domain types"
```

---

### Task 3: `BuildGraphManager` — persistence skeleton (create run, seed tasks, read)

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts`
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/pipeline/build-graph-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { BuildGraphManager } from "./build-graph.js";

const waitFor = async (pred: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("BuildGraphManager — persistence", () => {
  let dir: string;
  let control: ControlDb;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bgm-"));
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a run and seeds tasks, parsing deps back to arrays", () => {
    const mgr = new BuildGraphManager({ control, runTask: async () => ({ report: "ok" }) });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
    ]);

    const view = mgr.view(runId)!;
    expect(view.goal).toBe("build it");
    expect(view.status).toBe("running"); // createRun starts a run ready to drive
    expect(view.tasks.map((t) => t.id).sort()).toEqual(["code", "review"]);
    const review = view.tasks.find((t) => t.id === "review")!;
    expect(review.deps).toEqual(["code"]); // JSON parsed back to array
    expect(review.status).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: FAIL — `BuildGraphManager` is not exported.

- [ ] **Step 3: Implement the manager skeleton**

Append to `packages/server/src/pipeline/build-graph.ts`:

```typescript
import { nanoid } from "nanoid";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "feat(build-graph): BuildGraphManager persistence skeleton"
```

---

### Task 4: `drive()` — happy path (linear chain runs in dep order, run finishes done)

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts`
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("BuildGraphManager — persistence", ...)` block in `build-graph-manager.test.ts`:

```typescript
  it("drives a linear chain in dependency order to done (degenerate pipeline)", async () => {
    const calls: string[] = [];
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        calls.push(task.id);
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
      { id: "test", title: "test", role: "tester", deps: ["review"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(calls).toEqual(["code", "review", "test"]);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: FAIL — `mgr.start is not a function`.

- [ ] **Step 3: Implement `start`/`drive` and the state setters**

Append the following methods inside the `BuildGraphManager` class in `build-graph.ts` (before the closing `}` of the class):

```typescript
  /** Start driving a run's graph in the background. */
  start(runId: string): void {
    void this.drive(runId).catch((err) => {
      console.error(`[build-graph] run ${runId} crashed:`, err);
      this.finishRun(runId, "failed");
    });
  }

  private async drive(runId: string): Promise<void> {
    // Single-worker loop: pick one ready task, run it, advance. The worker pool
    // (run up to `parallelism` ready tasks at once) arrives in Phase 2.
    for (;;) {
      const run = this.getRun(runId);
      if (!run || run.status !== "running") return; // aborted / gone
      const tasks = this.listTasks(runId);

      if (tasks.length > 0 && tasks.every((t) => t.status === "merged")) {
        this.finishRun(runId, "done");
        return;
      }

      const ready = readyTasks(tasks);
      if (ready.length === 0) {
        // Nothing runnable and not all merged → the graph is stuck.
        this.finishRun(runId, "failed");
        return;
      }

      const task = ready[0];
      this.setTaskStatus(runId, task.id, "running");

      const priorReports = tasks
        .filter((t) => t.status === "merged")
        .map((t) => ({ taskId: t.id, title: t.title, report: t.report }));

      let outcome: { report: string; pass?: boolean };
      try {
        outcome = await this.deps.runTask({ run, task, priorReports });
      } catch (err) {
        this.setTaskReport(runId, task.id, err instanceof Error ? err.message : String(err));
        this.setTaskStatus(runId, task.id, "failed");
        this.finishRun(runId, "failed");
        return;
      }

      const pass = outcome.pass ?? parseVerdict(outcome.report);
      this.setTaskReport(runId, task.id, outcome.report);

      if (pass) {
        this.setTaskStatus(runId, task.id, "merged");
        continue;
      }

      if (GATE_ROLES.has(task.role)) {
        if (!this.handleKickback(runId, task.id)) {
          this.finishRun(runId, "failed");
          return;
        }
        continue;
      }

      // A non-gate task explicitly failed — no kickback path; fail the run.
      this.setTaskStatus(runId, task.id, "failed");
      this.finishRun(runId, "failed");
      return;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS (2 tests). `handleKickback` is referenced but not yet defined — add a stub now so it compiles; Task 6 replaces it. Append inside the class:

```typescript
  private handleKickback(_runId: string, _taskId: string): boolean {
    return false; // replaced in Task 6
  }
```

Re-run: `pnpm --filter @otterbot/server test build-graph-manager` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "feat(build-graph): single-worker drive for linear graphs"
```

---

### Task 5: `drive()` — fan-out / fan-in (two independent coders, then an integrator)

**Files:**
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts`

This task adds no production code — it proves the DAG semantics already work. If it fails, the readiness/drive logic has a bug to fix before proceeding.

- [ ] **Step 1: Write the failing test**

Append inside the describe block:

```typescript
  it("runs independent tasks then releases the fan-in task once both merged", async () => {
    const order: string[] = [];
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "two-part feature");
    mgr.seedTasks(runId, "proj1", [
      { id: "code-a", title: "part A", role: "coder" },
      { id: "code-b", title: "part B", role: "coder" },
      { id: "integrate", title: "merge A+B", role: "integrator", deps: ["code-a", "code-b"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    // Both coders run before the integrator; integrator is last.
    expect(order[order.length - 1]).toBe("integrate");
    expect(order.slice(0, 2).sort()).toEqual(["code-a", "code-b"]);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it passes (already-implemented behavior)**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS (3 tests). If it FAILS, fix `readyTasks`/`drive` before continuing — the integrator must not run until both coders are `merged`.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "test(build-graph): cover fan-out/fan-in DAG scheduling"
```

---

### Task 6: `drive()` — gate kickback resets upstream work, then completes

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts` (replace the `handleKickback` stub; add `transitiveDepIds`)
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the describe block:

```typescript
  it("kicks a failed gate back to its deps, re-runs, then finishes done", async () => {
    const order: string[] = [];
    let reviewRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        if (task.role === "security-reviewer") {
          reviewRuns += 1;
          return { report: reviewRuns === 1 ? "VERDICT: FAIL" : "VERDICT: PASS" };
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "review", title: "review", role: "security-reviewer", deps: ["code"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    // code, review(FAIL) → reset code+review → code, review(PASS)
    expect(order).toEqual(["code", "review", "code", "review"]);
    const review = mgr.listTasks(runId).find((t) => t.id === "review")!;
    expect(review.attempt).toBe(1);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: FAIL — the run ends `failed` (the stub `handleKickback` returns false), so it never reaches `done`.

- [ ] **Step 3: Replace the kickback stub with the real implementation**

In `build-graph.ts`, replace the `handleKickback` stub with:

```typescript
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
```

Add this exported helper near `readyTasks` (module scope, not in the class):

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "feat(build-graph): gate kickback resets upstream tasks with bounded retries"
```

---

### Task 7: `drive()` — attempt exhaustion fails the run

**Files:**
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the describe block:

```typescript
  it("fails the run when a gate keeps failing past the attempt budget", async () => {
    const mgr = new BuildGraphManager({
      control,
      maxAttempts: 2,
      runTask: async ({ task }) =>
        task.role === "tester" ? { report: "VERDICT: FAIL" } : { report: `did ${task.id}` },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [
      { id: "code", title: "implement", role: "coder" },
      { id: "test", title: "test", role: "tester", deps: ["code"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status !== "running");
    expect(mgr.getRun(runId)?.status).toBe("failed");
    const test = mgr.listTasks(runId).find((t) => t.id === "test")!;
    expect(test.attempt).toBe(2); // bumped to the cap, then exhausted
  });
```

- [ ] **Step 2: Run test to verify it passes (already-implemented behavior)**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS (5 tests). The kickback bound from Task 6 already enforces this; this test locks the behavior in.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "test(build-graph): cover attempt-exhaustion run failure"
```

---

### Task 8: Full Phase 1 verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS — all new build-graph tests plus the existing `pipeline-manager` suite (unchanged) are green.

- [ ] **Step 2: Type-check the server build**

Run: `pnpm --filter @otterbot/server build`
Expected: `tsc` completes with no errors.

- [ ] **Step 3: Commit any incidental fixes**

```bash
git add -A
git commit -m "chore(build-graph): Phase 1 verification green" --allow-empty
```

---

## Self-Review

**Spec coverage (Phase 1 portions of `2026-06-04-pm-multi-agent-build-graph-design.md`):**
- §1 Data model → Tasks 1–3 create `build_runs` + `tasks` and the `BuildRun`/`BuildTask` types. ✓
- §1 Lifecycle / "ready iff deps merged" → Task 2 `readyTasks`. ✓
- §2 Scheduler "generalize `drive()`", background, single-worker for now → Task 4. ✓
- §2 DAG fan-out/fan-in → Task 5. ✓
- §8 Kickback on gate fail + `MAX_ATTEMPTS` bound → Tasks 6–7. ✓
- §7 Migration "linear graph reproduces today's pipeline (N=1 case)" → Task 4's degenerate-chain test. ✓
- **Deferred to Phase 2 (intentionally out of scope here):** worker pool / `parallelism` concurrency, git worktree isolation, the serial integrator + real merge/test gate, orchestrator/bus/PM-tool wiring. The `parallelism` column and `integration_branch`/`branch`/`worktree_path`/`transcript_ref` columns are created now (cheap, avoids a later migration) but unused until Phase 2.
- **Deferred to Phase 3:** transcript persistence (`transcript_ref`), task board UI, live `build:update` events.

**Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step shows complete code; every test step shows the full test and the exact run command + expected result. The `handleKickback` stub in Task 4 is explicitly a temporary compile shim, replaced with full code in Task 6 (and the plan says so).

**Type consistency:** `BuildTask`, `BuildRun`, `TaskRole`, `TaskStatus`, `RunStatus`, `BuildRunView`, `TaskSpec`, `RunTaskArgs`, `BuildGraphDeps` are defined once in Task 2/3 and reused verbatim. Method names are stable across tasks: `createRun`, `seedTasks`, `start`, `drive`, `getRun`, `listTasks`, `view`, `setTaskStatus`, `setTaskReport`, `setTaskAttempt`, `finishRun`, `handleKickback`, and module helpers `readyTasks`, `transitiveDepIds`, `parseVerdict` (re-exported from `pipeline-manager.ts`). Column names match between the Drizzle schema (Task 1 Step 3) and the raw DDL (Task 1 Step 4).
