# Build Graph — Phase 2a: Parallel Worker Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize `BuildGraphManager.drive()` from a single-worker loop into a concurrent worker pool that runs up to `run.parallelism` dependency-ready tasks at once, while correctly distinguishing "nothing ready but workers still running" (wait) from "truly stuck" (fail).

**Architecture:** `drive()` keeps a local `inFlight` map of running task promises. Each loop iteration: finish the run if everything is merged and nothing is in flight; otherwise dispatch ready tasks up to the remaining capacity (`parallelism - inFlight.size`), then `await Promise.race(inFlight)` for the next completion and process it. A run only fails as "stuck" when nothing is ready **and** nothing is in flight. All other semantics (gate kickback, bounded retries, fail-fast on error/non-gate-fail, abort via run status) are preserved from Phase 1. Execution stays decoupled from the bus via the injected `runTask` callback, so the pool is fully unit-testable against a controllable fake.

**Tech Stack:** TypeScript (ESM), Vitest. Single-file change plus tests.

**Scope boundary:** This phase changes only the in-memory scheduling concurrency. It does NOT add git worktrees, the real integrator/merge, or orchestrator/bus/PM wiring — those are Phase 2b and 2c. Fail-fast on the first task error or non-gate failure (abandoning other in-flight tasks) is preserved from Phase 1 deliberately; graceful drain-on-failure is out of scope here.

**Pre-req:** Phase 1 is merged (`BuildGraphManager` in `packages/server/src/pipeline/build-graph.ts` with the sequential `drive()` at lines ~231-289, plus `readyTasks`, `GATE_ROLES`, `handleKickback`, the state setters, and the test file `build-graph-manager.test.ts` with a `waitFor` helper and 7 passing tests).

---

### Task 1: Make `drive()` run a concurrent worker pool

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts` (replace the entire `drive` method, ~lines 231-289)
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts` (append tests)

- [ ] **Step 1: Write the failing test**

Append these THREE `it(...)` blocks inside the existing `describe("BuildGraphManager — persistence", ...)` block in `build-graph-manager.test.ts`. The first proves concurrency (and fails against the sequential Phase 1 code); the other two lock in the cap and the wait-vs-stuck fix.

```typescript
  it("runs up to `parallelism` ready tasks concurrently", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll = () => {};
    const barrier = new Promise<void>((res) => {
      releaseAll = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "parallel", { parallelism: 3 });
    mgr.seedTasks(runId, "proj1", [
      { id: "a", title: "A", role: "coder" },
      { id: "b", title: "B", role: "coder" },
      { id: "c", title: "C", role: "coder" },
    ]);
    mgr.start(runId);

    await waitFor(() => active === 3);
    expect(peak).toBe(3);
    releaseAll();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });

  it("never exceeds the parallelism cap", async () => {
    let active = 0;
    let peak = 0;
    let releaseAll = () => {};
    const barrier = new Promise<void>((res) => {
      releaseAll = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        active += 1;
        peak = Math.max(peak, active);
        await barrier;
        active -= 1;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "cap", { parallelism: 2 });
    mgr.seedTasks(runId, "proj1", [
      { id: "a", title: "A", role: "coder" },
      { id: "b", title: "B", role: "coder" },
      { id: "c", title: "C", role: "coder" },
    ]);
    mgr.start(runId);

    await waitFor(() => active === 2);
    await new Promise((r) => setTimeout(r, 30)); // give the loop a chance to over-dispatch
    expect(peak).toBe(2); // third task held back while 2 are busy
    releaseAll();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(peak).toBe(2); // still capped even after the third ran
  });

  it("waits for in-flight tasks instead of failing when nothing else is ready", async () => {
    const order: string[] = [];
    let releaseSlow = () => {};
    const slowBarrier = new Promise<void>((res) => {
      releaseSlow = res;
    });
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        order.push(task.id);
        if (task.id === "slow") await slowBarrier;
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "wait", { parallelism: 3 });
    mgr.seedTasks(runId, "proj1", [
      { id: "slow", title: "slow coder", role: "coder" },
      { id: "after", title: "depends on slow", role: "integrator", deps: ["slow"] },
    ]);
    mgr.start(runId);

    await waitFor(() => order.includes("slow"));
    await new Promise((r) => setTimeout(r, 30)); // 'after' is blocked; nothing else is ready
    expect(mgr.getRun(runId)?.status).toBe("running"); // MUST NOT have failed as "stuck"
    releaseSlow();
    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(order).toEqual(["slow", "after"]);
  });
```

- [ ] **Step 2: Run tests to verify the concurrency test fails**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: FAIL — "runs up to `parallelism` ready tasks concurrently" times out in `waitFor(() => active === 3)` (the sequential Phase 1 `drive()` only ever runs one task at a time, so `active` never exceeds 1). The other two new tests may also fail/hang against the old code; that is expected — they pass once `drive()` is rewritten.

- [ ] **Step 3: Replace `drive()` with the concurrent worker-pool version**

In `packages/server/src/pipeline/build-graph.ts`, replace the **entire** `private async drive(runId: string): Promise<void> { ... }` method (currently ~lines 231-289) with:

```typescript
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
        // `readyTasks` excludes `running` tasks, so already-dispatched ones are
        // never re-selected; take the first `capacity` of what's left.
        for (const task of readyTasks(tasks).slice(0, capacity)) launch(run, task, tasks);
      }

      if (inFlight.size === 0) {
        // Nothing running and nothing became ready → the graph is stuck.
        this.finishRun(runId, "failed");
        return;
      }

      const settled = await Promise.race(inFlight.values());
      inFlight.delete(settled.taskId);

      if (settled.error) {
        this.setTaskReport(runId, settled.taskId, settled.error.message);
        this.setTaskStatus(runId, settled.taskId, "failed");
        this.finishRun(runId, "failed");
        return;
      }

      const outcome = settled.outcome!;
      const pass = outcome.pass ?? parseVerdict(outcome.report);
      this.setTaskReport(runId, settled.taskId, outcome.report);

      if (pass) {
        this.setTaskStatus(runId, settled.taskId, "merged");
        continue;
      }

      if (GATE_ROLES.has(settled.role)) {
        if (!this.handleKickback(runId, settled.taskId)) {
          this.finishRun(runId, "failed");
          return;
        }
        continue;
      }

      // A non-gate task explicitly failed — no kickback path; fail the run.
      this.setTaskStatus(runId, settled.taskId, "failed");
      this.finishRun(runId, "failed");
      return;
    }
  }
```

Notes for the implementer:
- This replaces ONLY the `drive` method body. Do not touch `start`, the state setters, `handleKickback`, or the reads — they are unchanged and still referenced.
- `BuildRun`, `BuildTask`, `TaskRole`, `readyTasks`, `GATE_ROLES`, `parseVerdict` are all already in scope in this file.
- Fail-fast (returning on the first error / non-gate failure) is intentional and matches Phase 1; abandoned in-flight promises were `.catch`-wrapped into resolved values, so there are no unhandled rejections.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS — all 10 tests (the 7 from Phase 1 plus the 3 new ones). If any Phase 1 test regressed (e.g. the fan-in or kickback ordering), the rewrite has a bug — fix `drive()`, do not weaken the tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "feat(build-graph): concurrent worker pool capped at run parallelism"
```

---

### Task 2: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS — all suites green (Phase 1 + Phase 2a build-graph tests and every pre-existing suite). The concurrency tests are timing-based; if one is flaky, re-run once to confirm, but a consistent failure is a real bug in `drive()`.

- [ ] **Step 2: Type-check the server build**

Run: `pnpm --filter @otterbot/server build`
Expected: `tsc` completes with no errors.

---

## Self-Review

**Spec coverage (Phase 2 "worker pool / `parallelism` concurrency" slice):**
- Concurrent dispatch up to `parallelism` → Task 1 (`runs up to parallelism concurrently`, `never exceeds the cap`). ✓
- The reviewer-flagged fix — in-flight ≠ stuck → Task 1 (`waits for in-flight tasks instead of failing`). ✓
- Preserved Phase 1 semantics (kickback, bounded retries, fail-fast, abort, linear/fan-in ordering) → guarded by the unchanged 7 Phase 1 tests still passing in Task 1 Step 4 and Task 2. ✓
- **Deferred (out of this slice):** git worktrees + serial integrator + real merge/test gate (Phase 2b); orchestrator/bus/PM-tool wiring + `runTask` backed by real agents (Phase 2c); graceful drain-on-failure instead of fail-fast.

**Placeholder scan:** No TBD/TODO/vague steps — the full replacement method and all three tests are shown verbatim, with exact run commands and expected results.

**Type consistency:** The new `drive()` references only existing identifiers (`BuildRun`, `BuildTask`, `TaskRole`, `readyTasks`, `GATE_ROLES`, `parseVerdict`, `this.setTaskStatus`, `this.setTaskReport`, `this.finishRun`, `this.handleKickback`, `this.getRun`, `this.listTasks`, `this.deps.runTask`) with their Phase 1 signatures. The local `Settled` type is self-contained. `Promise.race(inFlight.values())` consumes an iterable of `Promise<Settled>` and yields `Settled`.
