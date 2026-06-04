# PM Multi-Agent Build Graph — Design

**Date:** 2026-06-04
**Status:** Approved design, pending implementation plan

## Context

Today the PM agent coordinates work along a single, sequential track:

- `delegate(agentId, task)` sends one task to one peer and **blocks** the PM's
  turn (up to 300s) waiting for the reply.
- `pipeline_start(goal)` launches one **fixed, linear** pipeline
  (`coder → security-reviewer → test-writer → tester`) with a **single coder**
  doing all the code, gated by reviewers, bounded to `MAX_ATTEMPTS = 2`.
- Git/PR is centralized to the PM (only it commits/pushes), which deliberately
  avoids conflicts but blocks parallel coding.

The result: **one goal, one coder, one track, sequential.** On larger projects
the PM hits four walls at once (all four were called out as priorities):

1. One coder, no parallelism.
2. Can't juggle multiple concurrent features.
3. Weak decomposition/planning (jumps from goal straight to pipeline).
4. Blocking delegation, no live oversight.

These collapse into a single backbone: a **persistent build graph** the PM
*plans* and *supervises*, executed *asynchronously* across a *pool of coders* in
*isolated worktrees*, integrated *serially*. The existing 4-stage pipeline
becomes the degenerate single-task case, so nothing regresses.

### Decisions locked during brainstorming

- **Scope:** one comprehensive design covering all phases.
- **Merge strategy:** **serial integration branch** — coders work in parallel on
  isolated worktree branches; an integrator merges them one at a time onto an
  integration branch behind a test gate; conflict/fail kicks the task back to its
  coder.
- **Fan-out model:** **graph tasks only** — all otterbot-level fan-out is child
  tasks on the board (`task_split`); no opaque nested subagents. Coding-CLI
  *internal* helper agents are captured via the CLI session transcript, not
  modeled as otterbot agents.

### Intended outcome

The PM decomposes a large goal into a task graph, an orchestrator-side scheduler
runs it across N parallel coders in isolated worktrees, an integrator merges
serially behind a test gate, and every unit of work is live-observable and
permanently inspectable after completion. The PM's `maxSteps` is no longer the
coordination ceiling because execution runs in the scheduler, not the PM's turn.

## Goals / Non-goals

**Goals**
- Parallel coding across a pool of workers, isolated by git worktree.
- A persistent, inspectable task graph per goal; multiple concurrent graphs per
  project (juggle features).
- Deliberate decomposition with a source-keyed approval gate.
- Async, non-blocking PM supervision with escalations.
- Live observability + durable post-hoc review of all worker output.

**Non-goals (YAGNI for v1)**
- Opaque nested subagent spawning (replaced by graph tasks).
- Auto conflict-resolution tasks / disjoint-file partitioning (serial
  integration branch chosen instead).
- Cross-project / global work-stealing load balancers.
- Changing git centralization (PM/integrator retains forge ownership).

## Architecture

### 1. Data model & task lifecycle

Two new tables in `control.db`
(`packages/server/src/db/control-schema.ts`), generalizing today's
`pipeline_runs` / `pipeline_stage_results`:

**`build_runs`** — one per goal/feature (a project may have several concurrent):
```
id, projectId, goal,
status (planning | awaiting_approval | running | integrating | reviewing
        | done | failed | aborted),
integrationBranch, parallelism, prNumber, prUrl, createdAt
```

**`tasks`** — the graph nodes:
```
id, runId, projectId, title, description,
role (coder | integrator | security-reviewer | test-writer | tester),
deps (json: task ids), status, assignedAgentId,
branch, worktreePath, attempt, filesHint (json, optional),
report, transcriptRef, createdAt, updatedAt
```

**Task status lifecycle:**
```
blocked ──(deps satisfied)──▶ ready ──(dispatched)──▶ running
   ▲                                                     │
   │                                          (coder done)
   │                                                     ▼
   └──(attempt++, kickback)── conflict/fail ◀── merging ◀── awaiting_merge
                                                     │
                                              (clean merge)
                                                     ▼
                                                  merged
attempts exhausted ──▶ failed (escalate to PM)
```

A task is **ready** iff every dep is `merged`/`done`. This readiness computation
is the scheduler's core — pure and unit-testable.

### 2. Execution engine

**Scheduler** — generalize `pipeline-manager.ts` `drive()` from a linear list
into a graph driver. Lives in the orchestrator, runs in the **background, not on
the PM's turn**. On any task state change it: recomputes ready tasks → dispatches
up to `parallelism` of them to the worker pool → enqueues finished coding tasks
to the integrator. Reuses `MAX_ATTEMPTS` and `STAGE_TIMEOUT_MS`.

**Worker pool** — reuses the existing `dispatchToSubagent` / `dispatchQueues`
machinery (already a half-built worker pool). Each ready coding task spins up a
coder worker; concurrency capped by the run's `parallelism` (default 3, capped by
an instance setting); excess ready tasks queue FIFO.

**Worktree isolation** — each coding task gets its own git worktree off the
integration branch:
```
git worktree add .worktrees/<taskId> -b task/<runId>/<taskId>
```
The coder's coding-CLI runs there, fully isolated. For multi-repo projects, a
worktree per touched repo. Cleaned up (`git worktree remove`) on task done/fail;
**branches retained until the PR merges** (they are the durable record of what
each worker changed).

**Serial integrator** — an orchestrator-driven step running **under the PM's
git/forge ownership** (keeps git centralized, stays off the PM's turn). Pulls
`awaiting_merge` tasks **one at a time**, merges each branch onto the integration
branch, runs the **test gate** after each merge. Conflict or test-fail → kick the
task back to its coder with the conflict/failure context (attempt++). Merging
serializes; coding stays parallel.

**End of run** — once all coding tasks are `merged`, run the existing **review +
test gates** (security-reviewer, tester) on the integration branch, then the PM
opens the PR.

**Flow:**
```
goal → plan → approve → build_start
     → scheduler dispatches coders (parallel, isolated worktrees)
     → integrator merges serially behind test gate
     → kickbacks on conflict/fail
     → all merged → review + test gates → PR
```

### 3. Fan-out (graph tasks only)

Worker fan-out happens as **child tasks on the build graph**, never as opaque
subagents:

- A worker that finds its task too big calls **`task_split`**, adding child task
  nodes (with deps); the scheduler dispatches them to more workers.
- This makes every unit of work a visible, durable board card (recursively) and
  sidesteps the current `canSpawnSubagents: false` nesting limit — bounded by the
  graph rather than an arbitrary flag.
- Coding-CLI *internal* helper agents (e.g. `claude` spawning its own helpers)
  are one layer down and opaque to otterbot; they are captured via the **CLI
  session transcript** linked from the task, not modeled as otterbot agents.

### 4. PM tools & role shift

The PM stops *doing* coordination in its turn and instead **plans and
supervises**:

- `plan_build(goal)` → delegates scoping to a coder-planner (plan-only mode, no
  edits) which emits a **task graph** (nodes + deps + optional `filesHint`);
  returns it for review.
- `build_start(runId)` → hands the approved graph to the scheduler; **returns
  immediately** (async).
- `build_status(runId)` / `task_board(projectId)` → non-blocking read of the
  board (tasks, statuses, workers, recent reports, blockers).
- `task_add` / `task_revise` / `abort_run` → adjust the graph mid-flight.
- `task_split` (workers only) → the sole fan-out primitive.
- Keep `delegate` for true one-offs; add `delegate_async` for fire-and-forget
  replies that land as future bus events.

**Escalations** — the scheduler emits bus events on milestones (task failed after
max attempts, merge needs a decision, run done). The PM reacts *next turn*:
re-plan, approve, or abort. Because execution lives in the scheduler, the PM's
`maxSteps` is no longer the coordination ceiling (raising it still helps richer
planning).

### 5. Decomposition & approval

`plan_build` reuses the existing **"PM plans with the coder first"** pattern: the
coder drafts the graph in plan-only mode (must not edit code or launch the
pipeline while planning). Approval reuses the existing **source-keyed gate**:

- **Chat-originated goal** → present plan, wait for explicit user approval.
- **Assigned issue** → assignment *is* approval, proceed automatically.

Re-planning mid-run (adding/splitting tasks) goes through the same gate when
chat-sourced.

### 6. Observability & durable review

Four durable layers, all surviving worker teardown:

1. **`bus_messages`** — goal in, report out (already persisted).
2. **`tasks` rows** — status, attempts, result summary, merge outcome.
3. **Persisted transcript per task (NEW)** — today subagents are torn down and
   their dir/db *deleted*; change teardown to first flush the full step/tool-call
   transcript (and the linked CLI session log) to a durable store keyed by
   `runId/taskId` (`tasks.transcriptRef`).
4. **The git branch per task** — `task/<runId>/<taskId>` is a permanent, exact
   record of the code that worker wrote; `git diff` it anytime.

**Live view**
- **Task board** in the project view: status columns; live cards showing worker,
  branch, current tool/step, last report; wired via new `build:update` socket
  events alongside `agent:status`.
- **Per-worker live feed** — each worker is a real agent runtime, so its streaming
  output is surfaced like a chat transcript while it runs.

**Post-hoc drill-down** — per-task page = goal + worker + persisted transcript +
the branch **diff** + report + merge outcome.

Reuse `ActivityView.tsx` patterns and the `Badge` component.

### 7. Migration & back-compat

`pipeline-manager.ts` generalizes into the scheduler; `pipeline_runs` /
`pipeline_stage_results` evolve into `build_runs` / `tasks`. **A simple goal
produces a degenerate graph** — one coder task → integrate → review → test — so
today's behavior is exactly the N=1 case. `pipeline_start(goal)` remains as sugar
that builds the default template. Existing gate stages (security-reviewer,
tester) and `MAX_ATTEMPTS` / `STAGE_TIMEOUT_MS` are reused unchanged.

### 8. Error handling & limits

- Per-task retries bounded by `MAX_ATTEMPTS`; exhaustion → `failed` → escalate to
  the PM.
- Merge conflict / post-merge test-fail → kick the task back to its coder with
  context (attempt++).
- Worker crash/timeout (`STAGE_TIMEOUT_MS`) → fail + reschedule or escalate.
- `parallelism` per run (default 3), capped by an instance setting; excess ready
  tasks queue FIFO via `dispatchQueues`.
- Worktrees cleaned on task done/fail; branches pruned after PR merge.

## Testing

- **Unit** (fake-model harness): ready-when-deps-merged computation; serial
  integrator ordering; kickback/retry bounding; worktree create/cleanup.
- **Integration**: a multi-task graph runs end-to-end against the fake model + a
  temp git repo — asserts parallel coding, serial merges, conflict kickback,
  review/test gates, PR opened. Extends `orchestrator.test.ts` patterns.
- **E2E** (playwright): task board updates live; drill-down shows transcript +
  diff.

## Key files (reuse / change)

| Concern | File |
|---|---|
| Scheduler (generalize `drive()`) | `packages/server/src/pipeline/pipeline-manager.ts` |
| Worker pool / dispatch | `packages/server/src/orchestrator/orchestrator.ts` (`dispatchToSubagent`, `dispatchQueues`) |
| PM tools | `packages/server/src/agent/tools.ts` |
| Team roles / PM persona | `packages/server/src/teams/team-template.ts` |
| New tables | `packages/server/src/db/control-schema.ts` |
| Bus (add async variant) | `packages/server/src/bus/bus.ts` |
| Worker teardown / transcript flush | `packages/server/src/orchestrator/orchestrator.ts` (`spawnSubagent`) |
| Task board UI | `packages/web/src/components/agents/` (new; reuse `ActivityView.tsx`, `Badge`) |

## Open questions / risks

- **Serial integration throughput** — the integrator is the single serialization
  point. Acceptable by design, but if merge+test is slow it can bottleneck a wide
  graph. Mitigation: test gate scope per merge can be narrowed; revisit if it
  bites.
- **Worktree cost** — N worktrees over the shared `/project` tree (and per repo
  for multi-repo). Disk + setup cost; bounded by `parallelism`.
- **Decomposition quality** — graph quality depends on the coder-planner; bad
  splits create conflict-heavy kickbacks. The approval gate is the safeguard.
- **Transcript storage growth** — persisting full transcripts per task adds
  storage; needs a retention/prune policy (tie to branch pruning at PR merge).
