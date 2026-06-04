# Build Graph — Phase 3: Observability (Build Runs view) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make build-graph runs visible and debuggable: a top-level **Build Runs** web view that lists runs and shows each run's task graph (role/status/deps/attempt/report) updating live, with per-task drill-down showing the task branch's **git diff** and the worker's captured **transcript**.

**Architecture:** Mirror the existing `pipeline:update → socket → store → view` path. Backend: `BuildGraphManager.listForProject`; orchestrator build-run listener channel + `onBuildUpdate` + `getBuildRun`/`listBuildRuns`/`buildTaskDiff`; `BuildGraphManager` constructed WITH an `onUpdate` that fans out to listeners; `socket.ts` emits `build:update`; REST endpoints for list/detail/diff/transcript; a `build_task_transcripts` control-db table captured in the coder-dispatch path. Frontend: a `build-runs-store` (load + `build:update` subscription) and a `BuildRunsView` with a runs list, a run's task board, and a task drill-down. Reuse `Badge`, `Card`, typography, the `getSocket()`/`apiFetch` helpers, and the App nav pattern.

**Tech Stack:** Server (Fastify + Socket.IO + Drizzle), Web (React + Zustand + socket.io-client), TS ESM, Vitest.

**Verification bar:** Backend changes are additive → `pnpm --filter @otterbot/server test` stays green + `build` tsc-clean, with new unit tests for `listForProject`/`buildTaskDiff` (real temp git repo). Web → `pnpm --filter @otterbot/web build` tsc/vite-clean. The **live** path (real runs populating the board, transcripts from real workers) needs the test server; the view is verifiable here against seeded/fake data.

**Key seams (from exploration):**
- Socket: `packages/server/src/socket.ts` `attachSocketServer` — `orch.onPipelineUpdate((run) => io.emit("pipeline:update", run))`; mirror with `onBuildUpdate`/`build:update`.
- Orchestrator: `pipelineListeners` set + `onPipelineUpdate` (~line 1830); `BuildGraphManager` constructed ~line 590 (currently no `onUpdate`); services already have `getBuildRun`.
- Routes: `packages/server/src/server.ts` — `GET /api/projects/:id/pipeline-runs`, `GET /api/pipeline-runs/:runId` (mirror).
- Web: `App.tsx` `VIEWS` array + `MainView` type + conditional render; `lib/socket.ts` `getSocket()`; `lib/api.ts` `apiFetch`; `stores/projects-store.ts` `bindSocket` (the `pipeline:update` handler is the exact template); `components/ui/{Badge,Card}.tsx`; `components/agents/ActivityView.tsx` (two-column + cards layout).
- Transcript source: an ephemeral worker's conversation lives in its agent.db (`schema.ts` `conversations`/`messages`); capture it right after `spawnSubagent` returns (the ctx is alive during the grace window) in the coder-dispatch cap.

---

### Task 1: `BuildGraphManager.listForProject` + orchestrator build-run plumbing + socket event

**Files:**
- Modify: `packages/server/src/pipeline/build-graph.ts` (add `listForProject`)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (listeners, `onUpdate`, `onBuildUpdate`, `getBuildRun`, `listBuildRuns`)
- Modify: `packages/server/src/socket.ts` (emit `build:update`)
- Test: `packages/server/src/pipeline/build-graph-manager.test.ts` (listForProject)

- [ ] **Step 1 (test):** add to `build-graph-manager.test.ts`:
```typescript
  it("lists runs for a project, newest first", () => {
    const mgr = new BuildGraphManager({ control, runTask: async () => ({ report: "ok" }) });
    const a = mgr.createRun("projX", "first", { status: "awaiting_approval" });
    const b = mgr.createRun("projX", "second", { status: "awaiting_approval" });
    mgr.createRun("projY", "other", { status: "awaiting_approval" });
    const ids = mgr.listForProject("projX").map((r) => r.id);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(ids).not.toContain(mgr.listForProject("projY").find((r) => r.goal === "other") ? undefined : "x");
    expect(mgr.listForProject("projX").length).toBe(2);
  });
```
- [ ] **Step 2:** run `pnpm --filter @otterbot/server test build-graph-manager` → FAIL (`listForProject` missing).
- [ ] **Step 3 (impl):** in `build-graph.ts` add (mirror `PipelineManager.listForProject`; import `desc` from `drizzle-orm` alongside `eq`):
```typescript
  /** All runs for a project, newest first. */
  listForProject(projectId: string): BuildRun[] {
    return this.deps.control.db
      .select()
      .from(controlSchema.buildRuns)
      .where(eq(controlSchema.buildRuns.projectId, projectId))
      .orderBy(desc(controlSchema.buildRuns.createdAt))
      .all() as BuildRun[];
  }
```
- [ ] **Step 4:** in `orchestrator.ts`:
  - add `private readonly buildListeners = new Set<(run: BuildRunView) => void>();` near `pipelineListeners` (import `BuildRunView` from `../pipeline/build-graph.js`).
  - in the `new BuildGraphManager({...})` construction, replace the omitted-onUpdate comment with:
    ```typescript
      onUpdate: (view) => {
        for (const listener of this.buildListeners) listener(view);
        // TODO(2c): publish integration branch + open PR on done
      },
    ```
  - add methods near `onPipelineUpdate`:
    ```typescript
    onBuildUpdate(listener: (run: BuildRunView) => void): () => void {
      this.buildListeners.add(listener);
      return () => this.buildListeners.delete(listener);
    }
    getBuildRunView(runId: string): BuildRunView | null {
      return this.buildGraph.view(runId);
    }
    listBuildRuns(projectId: string) {
      return this.buildGraph.listForProject(projectId);
    }
    ```
    (Note: a `getBuildRun` *service* field already exists; this adds orchestrator-level methods used by routes/sockets. Name the view getter `getBuildRunView` to avoid colliding with any existing `getBuildRun` method.)
- [ ] **Step 5:** in `socket.ts` `attachSocketServer`, after the `onPipelineUpdate` registration add:
```typescript
  orch.onBuildUpdate((run) => {
    io.emit("build:update", run);
  });
```
- [ ] **Step 6:** `pnpm --filter @otterbot/server test` green; `pnpm --filter @otterbot/server build` tsc-clean.
- [ ] **Step 7 (commit):** `git commit -m "feat(build-graph): listForProject + build:update socket event + orchestrator getters"`

---

### Task 2: REST endpoints — list, detail, diff

**Files:** Modify `packages/server/src/server.ts`; add `buildTaskDiff` to `orchestrator.ts`; test the diff helper.

- [ ] **Step 1 (impl — orchestrator diff method):** add to `orchestrator.ts` (reuse the primary-repo resolution from `makeBuildTaskCaps`; use `spawnSync` like `currentBranch`). The task branch is `task/<runId>/<taskId>`; diff it against the run's base:
```typescript
  /** The git diff a build task's branch introduced, or null if unavailable. */
  buildTaskDiff(runId: string, taskId: string): string | null {
    const run = this.buildGraph.getRun(runId);
    if (!run) return null;
    const repos = this.projects.listRepos(run.projectId);
    const repo = repos.find((r) => r.isPrimary) ?? repos[0];
    if (!repo) return null;
    const base = this.currentBranch(repo.repoPath);
    const branch = `task/${runId}/${taskId}`;
    const r = spawnSync("git", ["-C", repo.repoPath, "diff", `${base}...${branch}`], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (r.status !== 0) return null;
    return r.stdout ?? "";
  }
```
- [ ] **Step 2 (impl — routes):** in `server.ts`, near the pipeline routes:
```typescript
  app.get<{ Params: { id: string } }>("/api/projects/:id/build-runs", async (req) =>
    orch.listBuildRuns(req.params.id)
  );
  app.get<{ Params: { runId: string } }>("/api/build-runs/:runId", async (req, reply) => {
    const run = orch.getBuildRunView(req.params.runId);
    if (!run) { reply.code(404); return { error: "not found" }; }
    return run;
  });
  app.get<{ Params: { runId: string; taskId: string } }>(
    "/api/build-runs/:runId/tasks/:taskId/diff",
    async (req) => ({ diff: orch.buildTaskDiff(req.params.runId, req.params.taskId) ?? "" })
  );
```
- [ ] **Step 3 (test):** unit-test `buildTaskDiff`-style logic is awkward through the orchestrator; instead add a small real-git test for the diff command shape in a new `packages/server/src/pipeline/task-diff.test.ts` ONLY IF you extract a pure helper. Otherwise rely on tsc + the manual/live check (note this in the commit). Prefer: keep `buildTaskDiff` in the orchestrator (no extracted helper) and skip a dedicated unit test (it needs full orchestrator + repo); ensure tsc + suite green.
- [ ] **Step 4:** `pnpm --filter @otterbot/server build` tsc-clean; `pnpm --filter @otterbot/server test` green.
- [ ] **Step 5 (commit):** `git commit -m "feat(build-graph): REST endpoints for build runs (list, detail, task diff)"`

---

### Task 3: Transcript persistence + fetch endpoint

**Files:** `packages/server/src/db/control-schema.ts` + `control-db.ts` (new table); `orchestrator.ts` (capture in coder dispatch + fetch method); `server.ts` (route).

- [ ] **Step 1 (schema):** add a Drizzle table `buildTaskTranscripts` (in control-schema.ts) and matching `CREATE TABLE IF NOT EXISTS build_task_transcripts (...)` DDL + index in control-db.ts:
```typescript
export const buildTaskTranscripts = sqliteTable("build_task_transcripts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: text("run_id").notNull(),
  taskId: text("task_id").notNull(),
  attempt: integer("attempt").notNull().default(0),
  content: text("content").notNull(), // JSON: [{role, content, toolCalls}]
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
});
```
DDL:
```sql
CREATE TABLE IF NOT EXISTS build_task_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL, task_id TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL, created_at TEXT NOT NULL
)
CREATE INDEX IF NOT EXISTS idx_build_task_transcripts ON build_task_transcripts(run_id, task_id)
```
- [ ] **Step 2 (capture):** in `makeBuildTaskCaps().dispatchCoder`, after `const res = await this.spawnSubagent(coderId, prompt, { projectWorkspacePathOverride: worktreePath });`, capture the worker transcript before its grace-window teardown:
```typescript
        this.captureTaskTranscript(res.subagentId, task.runId, task.id, task.attempt);
```
and add the private method (query the worker ctx's messages; tolerate absence):
```typescript
  private captureTaskTranscript(agentId: string, runId: string, taskId: string, attempt: number): void {
    try {
      const ctx = this.contexts.get(agentId);
      if (!ctx) return;
      const msgs = ctx.db.select().from(agentSchema.messages).all() as Array<{
        role: string; content: string; toolCalls: unknown;
      }>;
      const content = JSON.stringify(
        msgs.map((m) => ({ role: m.role, content: m.content, toolCalls: m.toolCalls ?? null }))
      );
      this.control.db
        .insert(controlSchema.buildTaskTranscripts)
        .values({ runId, taskId, attempt, content, createdAt: new Date().toISOString() })
        .run();
      this.control.db
        .update(controlSchema.tasks)
        .set({ transcriptRef: `${runId}/${taskId}` })
        .where(eq(controlSchema.tasks.id, taskId))
        .run();
    } catch (err) {
      console.warn(`[build-graph] transcript capture failed for ${taskId}:`, err);
    }
  }
```
Import `agentSchema` (the per-agent schema with `messages`) — check how `agent-context.ts` exposes `ctx.db` and the messages table; use the same import the codebase uses for that schema. `SpawnResult` must expose `subagentId` (confirm; the exploration shows it does).
- [ ] **Step 3 (fetch method + route):** orchestrator:
```typescript
  getBuildTaskTranscript(runId: string, taskId: string): Array<{ role: string; content: string; toolCalls: unknown }> {
    const rows = this.control.db
      .select()
      .from(controlSchema.buildTaskTranscripts)
      .where(and(eq(controlSchema.buildTaskTranscripts.runId, runId), eq(controlSchema.buildTaskTranscripts.taskId, taskId)))
      .orderBy(desc(controlSchema.buildTaskTranscripts.attempt))
      .all() as Array<{ content: string }>;
    if (rows.length === 0) return [];
    try { return JSON.parse(rows[0].content); } catch { return []; }
  }
```
route in `server.ts`:
```typescript
  app.get<{ Params: { runId: string; taskId: string } }>(
    "/api/build-runs/:runId/tasks/:taskId/transcript",
    async (req) => ({ transcript: orch.getBuildTaskTranscript(req.params.runId, req.params.taskId) })
  );
```
(`and`, `desc`, `eq` from drizzle-orm.)
- [ ] **Step 4:** `pnpm --filter @otterbot/server build` tsc-clean; `pnpm --filter @otterbot/server test` green. (Capture path is on the not-live-verified coder dispatch; bar is additive + green.)
- [ ] **Step 5 (commit):** `git commit -m "feat(build-graph): per-task worker transcript capture + fetch endpoint"`

---

### Task 4: Frontend store + Build Runs view + nav

**Files:** Create `packages/web/src/stores/build-runs-store.ts`, `packages/web/src/components/agents/BuildRunsView.tsx`; modify `packages/web/src/App.tsx`.

- [ ] **Step 1 (store):** create `build-runs-store.ts` mirroring `projects-store.ts`'s socket pattern. Local TS interfaces for the JSON shapes (`BuildRunSummary`, `BuildRunDetail`, `BuildTaskView`). State: `runsByProject: Record<string, BuildRunSummary[]>`, `detail: Record<string, BuildRunDetail>`, `socketBound`. Methods: `loadForProject(projectId)` (`GET /api/projects/:id/build-runs`), `loadDetail(runId)` (`GET /api/build-runs/:runId`), `bindSocket()` subscribing `build:update` and upserting into both `detail[run.id]` and `runsByProject[run.projectId]`.
- [ ] **Step 2 (view):** create `BuildRunsView.tsx`: a project picker (reuse `useProjectsStore`), a runs list (cards: goal, status Badge, task count), and a selected-run detail showing task cards grouped/sorted, each with role + status Badge + attempt + truncated report. Reuse `Badge`/`Card`/typography and the two-column layout from `ActivityView.tsx`. Map statuses→Badge tones: `merged/done`→success, `running/merging`→warning, `failed/conflict`→danger, `blocked/awaiting_approval`→neutral, `ready`→info.
- [ ] **Step 3 (nav):** in `App.tsx` add `{ id: "builds", label: "Build Runs", icon: <pick a lucide icon, e.g. GitBranch> }` to `VIEWS`, extend `MainView` with `"builds"`, and render `{view === "builds" && <BuildRunsView />}`. Call `load`/`bindSocket` in the view's `useEffect`.
- [ ] **Step 4:** `pnpm --filter @otterbot/web build` → tsc + vite clean.
- [ ] **Step 5 (commit):** `git commit -m "feat(web): Build Runs view with live task board"`

---

### Task 5: Task drill-down — diff + transcript

**Files:** modify `BuildRunsView.tsx` (+ store fetchers for diff/transcript).

- [ ] **Step 1 (store):** add `loadTaskDiff(runId, taskId)` (`GET .../diff`) and `loadTaskTranscript(runId, taskId)` (`GET .../transcript`), storing into `diffs: Record<string,string>` / `transcripts: Record<string, Array<{role;content;toolCalls}>>` keyed `runId/taskId`.
- [ ] **Step 2 (view):** clicking a task card opens a drill-down panel: the task's full report, a **Diff** section (monospace `<pre>` of the diff text; empty-state "no diff / not yet run"), and a **Transcript** section (list of messages with role + content + tool-call summaries; empty-state "no transcript captured"). Lazy-fetch on open.
- [ ] **Step 3:** `pnpm --filter @otterbot/web build` clean.
- [ ] **Step 4 (commit):** `git commit -m "feat(web): build task drill-down (git diff + worker transcript)"`

---

## Self-Review
**Spec coverage (Phase 3):** task-board UI (T4) ✓; live `build:update` events (T1) ✓; per-task git diff (T2/T5) ✓; transcript persistence + display (T3/T5) ✓.
**Placeholder scan:** backend tasks have exact code; frontend tasks (T4/T5) describe components against the exact reused primitives + the `projects-store` socket template rather than full literal JSX (the implementer mirrors the established store/view pattern) — acceptable since the pattern is concrete and named, not vague.
**Type consistency:** `BuildRunView` (server) is the detail shape; web defines matching local interfaces. New orchestrator methods named to avoid collision (`getBuildRunView`, `listBuildRuns`, `buildTaskDiff`, `getBuildTaskTranscript`, `onBuildUpdate`). Socket event `build:update` carries the `BuildRunView` (run + tasks).
**Not-live-verified:** the board only fills with real data once the live coder path runs (test server); transcript capture is on that same path. Backend is additive + suite-green; web is build-clean. Visual/live verification is a test-server step.
