# Build Graph — Phase 2c: Orchestrator / Bus / PM-Tool Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the build graph into the live system: run coder tasks as worktree-bound parallel workers, run the integrator + gates inside the graph, and give the PM a plan→approve→build→observe tool surface — turning the unit-tested engine (Phases 1/2a/2b) into a working multi-agent build.

**Architecture:** Phase 2c is large and spans subsystems, so it is decomposed into four sub-slices, each its own reviewable unit. **2c-1** (scheduler failure semantics) is fully detailed and unit-testable below; **2c-2/2c-3/2c-4** are blueprinted (they touch the live orchestrator/sandbox and are verified against the fake-model harness + a running instance).

**Design decisions (resolved via brainstorming):**
1. **Worker model — worktree-bound ephemeral workers.** Each coder task gets a host-created `git worktree` (Phase 2b `WorktreeManager`); a worker runs its coding-CLI bound to *that* worktree as `/project`, with a **per-worktree** coding lock so coders truly run in parallel (today's lock is per-project and would serialize them).
2. **Integrator — a graph task.** Decomposition appends an `integrator` task depending on all coder tasks; its `runTask` runs `integrateSerially` (Phase 2b) host-side; review/test gate tasks depend on the integrator.
3. **Coder failure — kick back + bounded retries.** A coder error / `pass:false` is retried like a gate failure; the run fails only when `MAX_ATTEMPTS` is spent. (This is 2c-1.)
4. **Approval — PM-judged `build_start`.** `plan_build` decomposes and leaves the run `awaiting_approval`; the PM presents the plan and calls `build_start(runId)` on the user's go. Issue-sourced runs auto-call `build_start`.

**Key existing seams (from exploration):**
- PipelineManager is constructed in `orchestrator.ts` (~line 538) with `runStage` doing `bus.request(PM → stage agent, buildStagePrompt(...))`, `STAGE_TIMEOUT_MS = 45m`, and an `onUpdate` that calls `publishRun` on done. BuildGraphManager will be wired the same way.
- Coders edit the tree bound at `/project`; the path comes from `ctx.projectWorkspacePath()` (fixed at agent start) and the **per-project** coding lock is `codingLockKey(agentId, projectWorkspacePath)` (`coding-cli.ts`). Sandbox mount is `shell.ts` `buildSandboxPlan`/`SandboxOpts.projectWorkspacePath` → `/project`.
- Commits are **host-side**: `ProjectStore.commitAll(repoPath, msg, ctx)` / `push(...)` with forge `GitContext` from `gitTargetFor(...)`; `orchestrator.publishRun` opens the PR.
- `spawnSubagent(parentId, goal, opts)` / `dispatchToSubagent` (service-agent pool, `dispatchQueues`, `subagentLimit`) is the worker mechanism; `agentForRole(projectId, role)` maps role→agent.
- PM tools live in `agent/tools.ts` gated by the `project-management` capability (`builtin-catalog.ts`), today just `pipeline_start`/`pipeline_status`.

**Scope note:** Only 2c-1 is executed from this plan now. 2c-2/2c-3/2c-4 are blueprints to be expanded into their own detailed task lists (and executed with running-system verification) in subsequent sessions.

---

## Sub-slice 2c-1: Unify task-failure handling into bounded kickback (DETAILED)

Today `drive()` only kicks back **gate** failures; a non-gate (coder) `pass:false` or any thrown error fails the whole run immediately. Per decision #3, *every* failure should kick the task back (reset + retry) and the run should fail only when the task's `MAX_ATTEMPTS` budget is exhausted.

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts` (the failure branch of `drive()`, currently lines ~294-321)
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these two `it(...)` blocks inside the existing `describe("BuildGraphManager — persistence", ...)` block in `build-graph-manager.test.ts`:

```typescript
  it("retries a coder task that returns pass:false, then completes", async () => {
    let coderRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        if (task.id === "code") {
          coderRuns += 1;
          return { report: `attempt ${coderRuns}`, pass: coderRuns > 1 }; // fail first, pass second
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(coderRuns).toBe(2);
    const code = mgr.listTasks(runId).find((t) => t.id === "code")!;
    expect(code.status).toBe("merged");
    expect(code.attempt).toBe(1);
  });

  it("retries a coder task that throws, then completes", async () => {
    let coderRuns = 0;
    const mgr = new BuildGraphManager({
      control,
      runTask: async ({ task }) => {
        if (task.id === "code") {
          coderRuns += 1;
          if (coderRuns === 1) throw new Error("transient boom");
          return { report: "recovered" };
        }
        return { report: `did ${task.id}` };
      },
    });
    const runId = mgr.createRun("proj1", "build it");
    mgr.seedTasks(runId, "proj1", [{ id: "code", title: "implement", role: "coder" }]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");
    expect(coderRuns).toBe(2);
    expect(mgr.listTasks(runId).find((t) => t.id === "code")!.status).toBe("merged");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: FAIL — both new tests. Under current code a non-gate `pass:false` and a thrown error each fail the run immediately, so the run never reaches `done` (it goes `failed`) and `coderRuns` stays at 1.

- [ ] **Step 3: Unify the failure branch in `drive()`**

In `packages/server/src/pipeline/build-graph.ts`, replace this block (currently ~lines 294-321):

```typescript
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
```

with this unified version:

```typescript
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
```

Note: `GATE_ROLES` is no longer referenced inside `drive()` after this change. Leave the exported `GATE_ROLES` constant in place (it stays part of the module's public surface and is used by the 2c-2 task runner to tell gate roles from coder roles). `parseVerdict` is still used above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @otterbot/server test build-graph-manager`
Expected: PASS — the two new tests plus all prior build-graph-manager tests. In particular confirm these PRE-EXISTING tests still pass unchanged (their behavior is preserved):
- "kicks a failed gate back to its deps, re-runs, then finishes done"
- "fails the run when a gate keeps failing past the attempt budget" (still `failed`, `attempt === 2`)
- "fails the run and records the error when a task throws" (a task that *always* throws still ends `failed` with the error recorded — now after exhausting retries rather than on the first throw)
- "fails gracefully on a dependency cycle instead of hanging" (still `failed` via the stuck path, unaffected)

- [ ] **Step 5: Full suite + build**

Run: `pnpm --filter @otterbot/server test` → all suites green.
Run: `pnpm --filter @otterbot/server build` → tsc clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/pipeline/build-graph.ts packages/server/src/pipeline/build-graph-manager.test.ts
git commit -m "feat(build-graph): unify task failure into bounded kickback (coder retries)"
```

---

## Sub-slice 2c-2: `BuildTaskRunner` — role→action coordinator (BLUEPRINT)

A new module `packages/server/src/pipeline/build-task-runner.ts` that implements `BuildGraphDeps.runTask` against an injected capability interface, so it is unit-testable with fakes (the real adapters are wired in 2c-3).

Sketch:
```ts
export interface BuildTaskCaps {
  baseBranch(run: BuildRun): string;                 // run integration base
  branchName(runId: string, taskId: string): string; // task/<runId>/<taskId> (deterministic)
  // coder
  addWorktree(runId: string, taskId: string, base: string): { path: string; branch: string };
  dispatchCoder(a: { task: BuildTask; worktreePath: string; priorReports: PriorReport[] }): Promise<string>;
  commitWorktree(a: { worktreePath: string; branch: string; taskId: string }): { ok: boolean; output: string };
  removeWorktree(taskId: string): void;
  // integrator (role === "integrator")
  coderBranches(runId: string): { taskId: string; branch: string }[];
  integrate(a: { items: { taskId: string; branch: string }[] }): MergeOutcome[];
  // gate / other roles (review, test-writer, tester)
  runGate(a: { task: BuildTask; priorReports: PriorReport[] }): Promise<string>;
}
export function makeRunTask(caps: BuildTaskCaps): BuildGraphDeps["runTask"];
```
Behavior by `task.role`:
- **coder:** add worktree off `baseBranch`; `dispatchCoder` (await report); `commitWorktree` to the task branch; `removeWorktree`; return `{ report }` (a hard dispatch error throws → scheduler kicks back per 2c-1).
- **integrator:** `integrate({ items: coderBranches(run.id) })`; `pass = outcomes.every(o => o.result === "merged")`; return `{ report: summarize(outcomes), pass }` (non-`merged` → kickback the integrator, whose transitive deps include the coders → they re-run).
- **gate / other:** `runGate` (a `bus.request` to the role's agent); return `{ report }` (gate emits `VERDICT:` parsed by the scheduler).

Tests: fakes for each capability; assert worktree lifecycle (add→commit→remove) per coder, integrator aggregates outcomes to pass/fail, gate passes report through. Unit-testable, no real git/agents.

**Open item for 2c-3:** how the integrator gets the conflict/test-fail context back to the *specific* coder on kickback (the scheduler resets the integrator's transitive deps = all coders; refine to reset only the offending coder(s) using `MergeOutcome.taskId`).

## Sub-slice 2c-3: Live orchestrator wiring (BLUEPRINT — needs running-system verification)

- Construct `BuildGraphManager` in `orchestrator.ts` (beside `PipelineManager`) with a real `BuildTaskCaps`:
  - `addWorktree`/`removeWorktree` → Phase 2b `WorktreeManager` over the project's primary repo (`<workspace>/.worktrees/<taskId>`); multi-repo handled per touched repo later.
  - `dispatchCoder` → spawn a worktree-bound worker. **Plumbing required:** allow `spawnSubagent`/the coding run to take a per-run `projectWorkspacePath` override (the worktree path) instead of `ctx.projectWorkspacePath()`, and make the coding lock key per-worktree (`codingLockKey(agentId, worktreePath)`) so workers don't serialize. Touches `coding-cli.ts` (`sandboxOptsFor`, lock), `shell.ts` (`SandboxOpts`), `spawnSubagent`.
  - `commitWorktree` → `ProjectStore.commitAll(worktreePath, msg, gitCtx)` host-side with forge `GitContext`.
  - `integrate` → check out the run's integration branch, `integrateSerially(repoPath, items, { runTests })` where `runTests` runs the project's test command in an **isolated checkout** (addresses the Phase 2b untracked-artifact note).
  - `runGate` → `bus.request(PM → role agent, buildStagePrompt-style prompt)`, mirroring the existing pipeline `runStage`.
- `onUpdate` → on `done`, `publishRun(runId)` (existing) to push the integration branch + open the PR; emit `build:update` events for the UI.
- Cleanup: remove worktrees + (optionally) prune task branches after PR; `WorktreeManager.remove` already retry-safe (`-B`).
- Verify against the fake-model harness (`OTTER_TEST_MODEL_URL`) with a temp git repo: a 2-coder graph runs in parallel, integrates serially, opens a PR.

## Sub-slice 2c-4: PM tools + approval + decomposition (BLUEPRINT)

- New PM tools in `agent/tools.ts`, added to the `project-management` capability (`builtin-catalog.ts`):
  - `plan_build(goal)` → delegate to the coder to draft a plan (reuse the plan-with-coder pattern), turn it into a task graph (coder tasks + an integrator + gate tasks with deps), `createRun` + `seedTasks`, leave status `awaiting_approval`; return the plan + `runId`.
  - `build_start(runId)` → guard status is `awaiting_approval`; flip to `running` and `start(runId)`. Issue-sourced runs auto-call this (mirror `startRunFromIssue` with `issueNumber`).
  - `task_board(projectId?)` / `build_status(runId)` → read the graph (non-blocking).
  - `task_add` / `task_revise` / `task_split` (workers) / `abort_run`.
- Approval gating mirrors today's source semantics: chat → PM presents plan, waits, calls `build_start`; assigned issue → auto. Update the PM persona/capability body to describe the plan→approve→build flow.
- Escalation: scheduler emits bus events (task failed after retries, run done) the PM reacts to next turn.

---

## Self-Review (2c-1 portion)

**Spec/decision coverage:** Decision #3 (coder failure → bounded kickback) → 2c-1 Tasks. Decisions #1/#2/#4 → blueprinted in 2c-2/2c-3/2c-4 with concrete seams. ✓
**Placeholder scan:** 2c-1 is fully code-complete (tests + exact replacement block + commands). The blueprint sections are explicitly labeled BLUEPRINT, not executable steps, and list concrete files/interfaces — they are a design record, not placeholders in an executable task.
**Type consistency:** 2c-1 touches only `drive()`'s failure branch; it reuses existing members (`setTaskReport`, `setTaskStatus`, `handleKickback`, `finishRun`, `parseVerdict`) and removes only the in-method use of `GATE_ROLES` (which stays exported). No signature changes.
**Regression risk:** Step 4 explicitly re-confirms the four behavior-sensitive pre-existing tests still pass; the always-throws and always-fail-gate cases still end `failed` (now after exhausting retries), and the stuck/cycle path is untouched.
