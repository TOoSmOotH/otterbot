# PM Issue Triage → Plan-Fed Auto-Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the PM (with the coder) triage new unassigned forge issues — post a candidate plan, refine it in response to issue-author/maintainer comments, and feed the latest plan into the build when the issue is assigned.

**Architecture:** Extend the existing `ForgeMonitor` 5-minute poll with a `pollTriage` pass. The monitor decides (initial-triage / refine / advance-watermark) using new read-only `Forge` methods; all side effects (ask the PM via the bus, comment, persist) live in orchestrator-provided deps. Triage state (current plan + comment high-water mark) lives in a new `issue_triage` table behind an `IssueTriageStore`. Gated per-project by a new `triageIssues` flag.

**Tech Stack:** TypeScript, Fastify, better-sqlite3 + Drizzle, Vitest (server, fake-forge unit tests), React + Zustand (web).

**Spec:** `docs/superpowers/specs/2026-06-01-pm-issue-triage-design.md`

---

## File Structure

**Server — created:**
- `packages/server/src/projects/issue-triage-store.ts` — CRUD for the `issue_triage` table.
- `packages/server/src/projects/issue-triage-store.test.ts` — its unit tests.

**Server — modified:**
- `packages/server/src/db/control-schema.ts` — `projects.triageIssues` column + `issueTriage` table.
- `packages/server/src/db/control-db.ts` — `CREATE TABLE`/`ALTER` migrations for both.
- `packages/server/src/forge/forge.ts` — `ForgeComment`, `ForgeIssue.assignees`, three new `Forge` methods, `commentIssue` returns the new comment id.
- `packages/server/src/forge/github.ts`, `gitea.ts` — implement the new methods.
- `packages/server/src/forge/forge.test.ts` — coverage for the new GitHub/Gitea methods.
- `packages/server/src/forge/forge-monitor.ts` — `pollTriage` + triage deps + in-flight guard.
- `packages/server/src/forge/forge-monitor.test.ts` — triage decision-logic tests.
- `packages/server/src/projects/project-store.ts` — `Project.triageIssues`, `setForge` patch, `listTriageEnabled()`.
- `packages/server/src/orchestrator/orchestrator.ts` — wire triage deps, `triageInitial`/`refinePlan`/`askPm`, feed plan into `startRunFromIssue`, `setProjectForge` writes `triageIssues`, construct `IssueTriageStore`.
- `packages/server/src/server.ts` — accept `triageIssues` in the forge endpoint body.

**Web — modified:**
- `packages/web/src/stores/projects-store.ts` — `Project.triageIssues`, `setForge` input.
- `packages/web/src/components/agents/ProjectsView.tsx` — "Triage issues" checkbox + payload.

> Run all server commands from `packages/server`. The whole repo root is
> `/home/mreeves/Projects/Personal/otter/otterbot`. Server tests use a fake model by
> default; the forge tests use an injected `fetch`, no network.

---

## Task 1: Schema + migrations + ProjectStore flag

**Files:**
- Modify: `packages/server/src/db/control-schema.ts`
- Modify: `packages/server/src/db/control-db.ts`
- Modify: `packages/server/src/projects/project-store.ts`

- [ ] **Step 1: Add the `triageIssues` column to the projects table schema**

In `control-schema.ts`, in the `projects` table, immediately after the
`monitorIssues` column (around line 206), add:

```ts
  /** Poll the forge for new unassigned issues and have the PM post/refine a plan. */
  triageIssues: integer("triage_issues", { mode: "boolean" }).notNull().default(false),
```

- [ ] **Step 2: Add the `issueTriage` table schema**

In `control-schema.ts`, after the `pipelineStageResults` table (end of file), add:

```ts
/**
 * Per-issue triage state for a forge-backed project. One row per (project, issue):
 * the current candidate `plan` the PM posted, and `lastCommentId` — the highest
 * forge comment id already processed, so the poller only reacts to newer comments.
 */
export const issueTriage = sqliteTable("issue_triage", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  issueNumber: integer("issue_number").notNull(),
  plan: text("plan").notNull().default(""),
  lastCommentId: integer("last_comment_id").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

- [ ] **Step 3: Add the create-table + migration SQL**

In `control-db.ts`, inside `ensureControlTables`, add a `CREATE TABLE IF NOT EXISTS
issue_triage (...)` statement to the `stmts` array (place it after the
`pipeline_stage_results` entry, before the closing `];`):

```ts
    `CREATE TABLE IF NOT EXISTS issue_triage (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      plan TEXT NOT NULL DEFAULT '',
      last_comment_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_triage_issue ON issue_triage(project_id, issue_number)`,
```

Then, in the projects-migration block, alongside the other `addProjectCol(...)`
calls, add:

```ts
  addProjectCol("triage_issues", "triage_issues INTEGER NOT NULL DEFAULT 0");
```

- [ ] **Step 4: Add `triageIssues` to the server `Project` interface + `setForge` patch**

In `project-store.ts`, in the `Project` interface after `monitorIssues` (line 38):

```ts
  /** Poll the forge for new unassigned issues; PM posts/refines a plan comment. */
  triageIssues: boolean;
```

And widen the `setForge` patch `Pick` (line 100) to include it:

```ts
    Partial<
      Pick<Project, "mode" | "forgeAccountId" | "forgeRepo" | "forkRepo" | "forgeSshUrl" | "baseBranch" | "monitorIssues" | "triageIssues" | "remoteE2e">
    >
```

- [ ] **Step 5: Add `listTriageEnabled()` to ProjectStore**

In `project-store.ts`, right after `listMonitored()` (line 131):

```ts
  /** Projects with PM issue-triage enabled (for the poller). */
  listTriageEnabled(): Project[] {
    return this.list().filter((p) => p.triageIssues && p.forgeAccountId && p.forgeRepo);
  }
```

- [ ] **Step 6: Build to verify the schema/types compile**

Run: `pnpm --filter @otterbot/server build`
Expected: `> tsc` with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/control-schema.ts packages/server/src/db/control-db.ts packages/server/src/projects/project-store.ts
git commit -m "feat(triage): projects.triageIssues flag + issue_triage table"
```

---

## Task 2: Forge abstraction — new read methods + comment id

**Files:**
- Modify: `packages/server/src/forge/forge.ts`
- Modify: `packages/server/src/forge/github.ts`
- Modify: `packages/server/src/forge/gitea.ts`
- Test: `packages/server/src/forge/forge.test.ts`

- [ ] **Step 1: Extend the forge types + interface**

In `forge.ts`, add `assignees` to `ForgeIssue` (after `author`, line 45):

```ts
  author: string;
  /** Logins of users the issue is assigned to (empty = unassigned). */
  assignees: string[];
```

Add a `ForgeComment` type after `ForgeIssue`:

```ts
export interface ForgeComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}
```

In the `Forge` interface, change `commentIssue` to return the new comment id and add
the three read methods (replace the existing `listAssignedIssues` / `commentIssue`
block, lines 95-97):

```ts
  /** Open issues assigned to the account's bot user. */
  listAssignedIssues(repo: string): Promise<ForgeIssue[]>;
  /** All open issues (not PRs), with assignees, for triage. */
  listOpenIssues(repo: string): Promise<ForgeIssue[]>;
  /** Comments on an issue, oldest first. */
  listIssueComments(repo: string, number: number): Promise<ForgeComment[]>;
  /** A user's permission on the repo, normalized. "none" if not a collaborator. */
  getUserPermission(repo: string, username: string): Promise<"admin" | "write" | "read" | "none">;
  /** Post a comment; resolves to the new comment's id. */
  commentIssue(repo: string, number: number, body: string): Promise<number>;
```

- [ ] **Step 2: Write failing tests for the GitHub methods**

In `forge.test.ts`, first read the top of the file to match its existing
fake-`fetch` helper style, then add a `describe` block. (The file already tests
GitHubForge/GiteaForge with an injected fetch — follow that exact pattern.) Add:

```ts
describe("GitHubForge triage methods", () => {
  it("listOpenIssues drops PRs and maps assignees", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify([
          { number: 1, title: "bug", body: "b", user: { login: "alice" }, html_url: "h", assignees: [] },
          { number: 2, title: "pr", body: "", user: { login: "bob" }, html_url: "h", pull_request: {}, assignees: [] },
          { number: 3, title: "feat", body: "", user: { login: "carol" }, html_url: "h", assignees: [{ login: "bot" }] },
        ]),
        { status: 200 }
      )) as unknown as typeof fetch;
    const forge = new GitHubForge(acct(), fetchFn);
    const issues = await forge.listOpenIssues("o/n");
    expect(issues.map((i) => i.number)).toEqual([1, 3]);
    expect(issues[1].assignees).toEqual(["bot"]);
  });

  it("getUserPermission normalizes and returns none on error", async () => {
    let call = 0;
    const fetchFn = (async () => {
      call += 1;
      return call === 1
        ? new Response(JSON.stringify({ permission: "write" }), { status: 200 })
        : new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const forge = new GitHubForge(acct(), fetchFn);
    expect(await forge.getUserPermission("o/n", "alice")).toBe("write");
    expect(await forge.getUserPermission("o/n", "ghost")).toBe("none");
  });
});
```

> `acct()` is the existing forge-account fixture in this test file. If it is named
> differently (e.g. an inline object), mirror whatever the existing GitHub tests use
> to construct a `GitHubForge`.

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm --filter @otterbot/server test -- forge.test`
Expected: FAIL — `listOpenIssues`/`getUserPermission` are not functions.

- [ ] **Step 4: Implement the GitHub methods**

In `github.ts`, update `listAssignedIssues`' map to include `assignees` and change
`commentIssue` to return the id; then add the three methods. Replace the existing
`listAssignedIssues` + `commentIssue` (lines 171-188) with:

```ts
  async listAssignedIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&assignee=${encodeURIComponent(this.account.username)}&per_page=30`
    )) as Array<{ number: number; title: string; body: string | null; user: { login: string }; html_url: string; pull_request?: unknown; assignees?: Array<{ login: string }> | null }>;
    return d
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", assignees: (i.assignees ?? []).map((a) => a.login), htmlUrl: i.html_url }));
  }

  async listOpenIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&per_page=30`
    )) as Array<{ number: number; title: string; body: string | null; user: { login: string }; html_url: string; pull_request?: unknown; assignees?: Array<{ login: string }> | null }>;
    return d
      .filter((i) => !i.pull_request)
      .map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", assignees: (i.assignees ?? []).map((a) => a.login), htmlUrl: i.html_url }));
  }

  async listIssueComments(repo: string, number: number): Promise<import("./forge.js").ForgeComment[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues/${number}/comments?per_page=100`
    )) as Array<{ id: number; user: { login: string }; body: string | null; created_at: string }>;
    return d.map((c) => ({ id: c.id, author: c.user?.login ?? "", body: c.body ?? "", createdAt: c.created_at }));
  }

  async getUserPermission(repo: string, username: string): Promise<"admin" | "write" | "read" | "none"> {
    const { owner, name } = splitRepo(repo);
    try {
      const d = (await this.api(
        `/repos/${owner}/${name}/collaborators/${encodeURIComponent(username)}/permission`
      )) as { permission?: string };
      const p = d.permission ?? "none";
      // GitHub's `permission` field already collapses maintain→write, triage→read.
      if (p === "admin" || p === "write" || p === "read") return p;
      return "none";
    } catch {
      return "none"; // 403/404 → not a collaborator
    }
  }

  async commentIssue(repo: string, number: number, body: string): Promise<number> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })) as { id: number };
    return d?.id ?? 0;
  }
```

Add `ForgeComment` to the type imports at the top of `github.ts` (it is referenced
inline above via `import("./forge.js")`, so no import edit is strictly required, but
prefer adding `type ForgeComment` to the existing import list and using it directly).

- [ ] **Step 5: Implement the Gitea methods**

In `gitea.ts`, update `listAssignedIssues`' map to include `assignees`, change
`commentIssue` to return the id, and add the three methods. Replace the existing
`listAssignedIssues` + `commentIssue` (lines 181-205) with:

```ts
  async listAssignedIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&type=issues&limit=30`
    )) as Array<{ number: number; title: string; body: string | null; user: { login: string }; html_url: string; assignees?: Array<{ login: string }> | null }>;
    const me = this.account.username.toLowerCase();
    return d
      .filter((i) => (i.assignees ?? []).some((a) => a.login.toLowerCase() === me))
      .map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", assignees: (i.assignees ?? []).map((a) => a.login), htmlUrl: i.html_url }));
  }

  async listOpenIssues(repo: string): Promise<ForgeIssue[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues?state=open&type=issues&limit=30`
    )) as Array<{ number: number; title: string; body: string | null; user: { login: string }; html_url: string; assignees?: Array<{ login: string }> | null }>;
    return d.map((i) => ({ number: i.number, title: i.title, body: i.body ?? "", author: i.user?.login ?? "", assignees: (i.assignees ?? []).map((a) => a.login), htmlUrl: i.html_url }));
  }

  async listIssueComments(repo: string, number: number): Promise<import("./forge.js").ForgeComment[]> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(
      `/repos/${owner}/${name}/issues/${number}/comments`
    )) as Array<{ id: number; user: { login: string }; body: string | null; created_at: string }>;
    return d.map((c) => ({ id: c.id, author: c.user?.login ?? "", body: c.body ?? "", createdAt: c.created_at }));
  }

  async getUserPermission(repo: string, username: string): Promise<"admin" | "write" | "read" | "none"> {
    const { owner, name } = splitRepo(repo);
    try {
      const d = (await this.api(
        `/repos/${owner}/${name}/collaborators/${encodeURIComponent(username)}/permission`
      )) as { permission?: string };
      const p = (d.permission ?? "none").toLowerCase();
      if (p === "owner" || p === "admin") return "admin";
      if (p === "write") return "write";
      if (p === "read") return "read";
      return "none";
    } catch {
      return "none";
    }
  }

  async commentIssue(repo: string, number: number, body: string): Promise<number> {
    const { owner, name } = splitRepo(repo);
    const d = (await this.api(`/repos/${owner}/${name}/issues/${number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    })) as { id: number };
    return d?.id ?? 0;
  }
```

- [ ] **Step 6: Run the forge tests to verify they pass**

Run: `pnpm --filter @otterbot/server test -- forge.test`
Expected: PASS (new + existing forge tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/forge/forge.ts packages/server/src/forge/github.ts packages/server/src/forge/gitea.ts packages/server/src/forge/forge.test.ts
git commit -m "feat(triage): forge listOpenIssues/listIssueComments/getUserPermission; commentIssue returns id"
```

---

## Task 3: IssueTriageStore

**Files:**
- Create: `packages/server/src/projects/issue-triage-store.ts`
- Test: `packages/server/src/projects/issue-triage-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `issue-triage-store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { IssueTriageStore } from "./issue-triage-store.js";

describe("IssueTriageStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: IssueTriageStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-triage-"));
    control = openControlDb(join(dir, "control.db"));
    store = new IssueTriageStore(control);
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an untriaged issue", () => {
    expect(store.get("p1", 7)).toBeNull();
  });

  it("upserts a plan + watermark and reads it back", () => {
    store.upsert("p1", 7, "first plan", 100);
    expect(store.get("p1", 7)).toEqual({ plan: "first plan", lastCommentId: 100 });
    store.upsert("p1", 7, "revised plan", 140);
    expect(store.get("p1", 7)).toEqual({ plan: "revised plan", lastCommentId: 140 });
  });

  it("advances only the watermark, keeping the plan", () => {
    store.upsert("p1", 7, "plan", 100);
    store.advanceWatermark("p1", 7, 120);
    expect(store.get("p1", 7)).toEqual({ plan: "plan", lastCommentId: 120 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @otterbot/server test -- issue-triage-store`
Expected: FAIL — cannot find `./issue-triage-store.js`.

- [ ] **Step 3: Implement the store**

Create `issue-triage-store.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- issue-triage-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/projects/issue-triage-store.ts packages/server/src/projects/issue-triage-store.test.ts
git commit -m "feat(triage): IssueTriageStore for per-issue plan + comment watermark"
```

---

## Task 4: ForgeMonitor triage loop (core decision logic, TDD)

**Files:**
- Modify: `packages/server/src/forge/forge-monitor.ts`
- Test: `packages/server/src/forge/forge-monitor.test.ts`

- [ ] **Step 1: Extend the monitor deps + types**

In `forge-monitor.ts`, add to `ForgeMonitorDeps` (after `resumeRun`, line 35):

```ts
  /** Projects with PM issue-triage enabled. */
  listTriageProjects(): MonitoredProject[];
  /** Current triage state for an issue, or null if never triaged. */
  getTriage(projectId: string, issueNumber: number): { plan: string; lastCommentId: number } | null;
  /** PM (with coder) drafts the first plan from the issue + any existing instruction comments; persists it. */
  triageInitial(projectId: string, issue: ForgeIssue, instructionComments: ForgeComment[]): Promise<void>;
  /** PM (with coder) revises the plan from new instruction comments; persists it. */
  refinePlan(projectId: string, issue: ForgeIssue, currentPlan: string, instructionComments: ForgeComment[]): Promise<void>;
  /** Move the comment high-water mark forward without changing the plan. */
  advanceWatermark(projectId: string, issueNumber: number, lastCommentId: number): void;
```

Update the import line at the top to pull in `ForgeComment`:

```ts
import type { Forge, ForgeComment, ForgeIssue } from "./forge.js";
```

- [ ] **Step 2: Write the failing triage tests**

In `forge-monitor.test.ts`, first update the shared fakes so the new surface exists:

In `fakeForge`, add defaults inside the returned object (after `commentIssue`):

```ts
    listOpenIssues: async () => [],
    listIssueComments: async () => [],
    getUserPermission: async () => "none",
```

Change the `commentIssue` default to return a number: `commentIssue: async () => 1,`.

Update the `issue` helper to include assignees:

```ts
const issue = (number: number, over: Partial<ForgeIssue> = {}): ForgeIssue => ({
  number,
  title: `issue ${number}`,
  body: "body",
  author: "alice",
  assignees: [],
  htmlUrl: "h",
  ...over,
});
```

Add the new deps to `baseDeps` defaults (after `resumeRun`):

```ts
    listTriageProjects: () => [],
    getTriage: () => null,
    triageInitial: async () => {},
    refinePlan: async () => {},
    advanceWatermark: () => {},
```

Import `ForgeComment` in the test header:

```ts
import type { Forge, ForgeIssue, ForgeComment, ForgePullRequest, ForgeReview, CheckState } from "./forge.js";
```

Then add this describe block:

```ts
describe("ForgeMonitor.pollTriage", () => {
  const comment = (id: number, author: string, body = "c"): ForgeComment => ({
    id,
    author,
    body,
    createdAt: "t",
  });

  it("initial-triages a new open unassigned issue, folding existing maintainer comments", async () => {
    const calls: Array<{ n: number; instr: number[] }> = [];
    const forge = fakeForge({
      listOpenIssues: async () => [issue(5)],
      listIssueComments: async () => [comment(10, "alice"), comment(11, "stranger")],
      getUserPermission: async (_r, u) => (u === "stranger" ? "none" : "write"),
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => null,
        triageInitial: async (_p, i, instr) => {
          calls.push({ n: i.number, instr: instr.map((c) => c.id) });
        },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    // alice is the issue author → folded; stranger has no permission → excluded.
    expect(calls).toEqual([{ n: 5, instr: [10] }]);
  });

  it("skips assigned issues", async () => {
    let triaged = 0;
    const forge = fakeForge({ listOpenIssues: async () => [issue(6, { assignees: ["bot"] })] });
    const deps = baseDeps(
      { listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }], triageInitial: async () => { triaged += 1; } },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(triaged).toBe(0);
  });

  it("refines only on new author/maintainer comments above the watermark", async () => {
    const refined: number[] = [];
    const forge = fakeForge({
      listOpenIssues: async () => [issue(7)],
      listIssueComments: async () => [comment(20, "alice", "old"), comment(30, "carol", "please add tests")],
      getUserPermission: async (_r, u) => (u === "carol" ? "write" : "none"),
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 25 }),
        refinePlan: async (_p, i, _plan, instr) => {
          refined.push(...instr.map((c) => c.id));
        },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toEqual([30]); // 20 is below the watermark; 30 is a maintainer
  });

  it("advances the watermark (no refine) when new comments are not instructions", async () => {
    let refined = 0;
    let advancedTo = 0;
    const forge = fakeForge({
      listOpenIssues: async () => [issue(8)],
      listIssueComments: async () => [comment(40, "stranger", "noise")],
      getUserPermission: async () => "none",
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 30 }),
        refinePlan: async () => { refined += 1; },
        advanceWatermark: (_p, _n, id) => { advancedTo = id; },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toBe(0);
    expect(advancedTo).toBe(40);
  });

  it("ignores the bot's own comments", async () => {
    let refined = 0;
    const forge = fakeForge({
      listOpenIssues: async () => [issue(9)],
      // account.username is "bot" in the fake forge
      listIssueComments: async () => [comment(50, "bot", "the plan")],
    });
    const deps = baseDeps(
      {
        listTriageProjects: () => [{ id: "p1", forgeRepo: "o/n" }],
        getTriage: () => ({ plan: "p", lastCommentId: 40 }),
        refinePlan: async () => { refined += 1; },
      },
      forge
    );
    await new ForgeMonitor(deps).pollOnce();
    expect(refined).toBe(0);
  });
});
```

- [ ] **Step 3: Run the triage tests to verify they fail**

Run: `pnpm --filter @otterbot/server test -- forge-monitor`
Expected: FAIL — `pollTriage` does not exist / `listTriageProjects` not used.

- [ ] **Step 4: Implement `pollTriage` + the in-flight guard**

In `forge-monitor.ts`, add an in-flight set field next to `merged` (line 41):

```ts
  /** issues currently being triaged/refined (a slow PM round must not double-fire). */
  private readonly inFlight = new Set<string>();
```

In `pollOnce`, run triage for triage-enabled projects. Replace the `pollOnce` body
loop so it also iterates triage projects (keep the existing monitored loop intact):

```ts
  async pollOnce(): Promise<void> {
    for (const project of this.deps.listMonitoredProjects()) {
      const forge = this.deps.forgeForProject(project.id);
      if (!forge) continue;
      try {
        await this.pollIssues(project, forge);
        await this.pollPullRequests(project, forge);
      } catch (err) {
        console.warn(`[forge-monitor] ${project.forgeRepo}:`, err instanceof Error ? err.message : err);
      }
    }
    for (const project of this.deps.listTriageProjects()) {
      const forge = this.deps.forgeForProject(project.id);
      if (!forge) continue;
      try {
        await this.pollTriage(project, forge);
      } catch (err) {
        console.warn(`[forge-monitor] triage ${project.forgeRepo}:`, err instanceof Error ? err.message : err);
      }
    }
  }
```

Add the triage methods (place after `pollIssues`):

```ts
  /** Draft/refine a PM plan on new unassigned issues. */
  async pollTriage(project: MonitoredProject, forge: Forge): Promise<void> {
    const permCache = new Map<string, "admin" | "write" | "read" | "none">();
    const issues = await forge.listOpenIssues(project.forgeRepo);
    for (const issue of issues) {
      if (issue.assignees.length > 0) continue; // assigned → not a triage candidate
      const key = `${project.id}#${issue.number}`;
      if (this.inFlight.has(key)) continue;

      const existing = this.deps.getTriage(project.id, issue.number);
      if (!existing) {
        const comments = await forge.listIssueComments(project.forgeRepo, issue.number);
        const instr = await this.instructions(forge, project.forgeRepo, issue, comments, permCache);
        this.inFlight.add(key);
        try {
          await this.deps.triageInitial(project.id, issue, instr);
        } finally {
          this.inFlight.delete(key);
        }
        continue;
      }

      const comments = await forge.listIssueComments(project.forgeRepo, issue.number);
      const me = forge.account.username.toLowerCase();
      const fresh = comments.filter((c) => c.id > existing.lastCommentId && c.author.toLowerCase() !== me);
      if (fresh.length === 0) continue;
      const instr = await this.instructions(forge, project.forgeRepo, issue, fresh, permCache);
      if (instr.length === 0) {
        const maxId = Math.max(existing.lastCommentId, ...comments.map((c) => c.id));
        this.deps.advanceWatermark(project.id, issue.number, maxId);
        continue;
      }
      this.inFlight.add(key);
      try {
        await this.deps.refinePlan(project.id, issue, existing.plan, instr);
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  /** Comments whose author may steer the plan: the issue author, or a write/admin user. */
  private async instructions(
    forge: Forge,
    repo: string,
    issue: ForgeIssue,
    comments: ForgeComment[],
    permCache: Map<string, "admin" | "write" | "read" | "none">
  ): Promise<ForgeComment[]> {
    const me = forge.account.username.toLowerCase();
    const author = issue.author.toLowerCase();
    const out: ForgeComment[] = [];
    for (const c of comments) {
      const who = c.author.toLowerCase();
      if (who === me) continue;
      if (who === author) {
        out.push(c);
        continue;
      }
      let perm = permCache.get(who);
      if (perm === undefined) {
        perm = await forge.getUserPermission(repo, c.author);
        permCache.set(who, perm);
      }
      if (perm === "admin" || perm === "write") out.push(c);
    }
    return out;
  }
```

> Note: the orchestrator's `triageInitial`/`refinePlan` set the new watermark to the
> id of the plan comment they post (newest id), so folded/processed comments fall
> below it and won't re-fire.

- [ ] **Step 5: Run the triage tests to verify they pass**

Run: `pnpm --filter @otterbot/server test -- forge-monitor`
Expected: PASS (new triage tests + existing pollIssues/pollPullRequests tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/forge/forge-monitor.ts packages/server/src/forge/forge-monitor.test.ts
git commit -m "feat(triage): ForgeMonitor.pollTriage decision logic + in-flight guard"
```

---

## Task 5: Orchestrator wiring (PM authoring, deps, plan-fed build)

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Construct the IssueTriageStore**

Add the import near the other store imports at the top of `orchestrator.ts`:

```ts
import { IssueTriageStore } from "../projects/issue-triage-store.js";
```

Add a field declaration next to the other store fields (search for
`private readonly projects: ProjectStore` and add below it). If fields are
implicitly typed via assignment, just assign in the constructor. Where `this.forge`
is assigned (line 521), add right after:

```ts
    this.issueTriage = new IssueTriageStore(control);
```

And declare the field where the other `private readonly` store fields are declared
(mirror how `forge`/`projects` are declared):

```ts
  private readonly issueTriage: IssueTriageStore;
```

- [ ] **Step 2: Add a constant + the PM-ask helper + triage/refine methods**

Near the top-of-class constants (where `STAGE_TIMEOUT_MS` is referenced — it is
already imported/defined for `runStage`), add a triage marker constant at module
scope (top of file, after imports):

```ts
/** Prefix on PM-authored issue comments so they're recognizable in the thread. */
const TRIAGE_MARKER = "🦦 **otterbot plan**";
```

Add these methods to the orchestrator class (place them near `startPipeline`):

```ts
  /** One-shot PM response over the bus (the PM consults the coder per its persona). */
  private async askPm(pmAgentId: string, prompt: string): Promise<string> {
    const res = await this.bus.request(
      {
        id: nanoid(),
        kind: "request",
        from: "coo",
        to: pmAgentId,
        threadId: nanoid(),
        correlationId: null,
        rootSpawnId: null,
        body: prompt,
        transport: "local",
      },
      STAGE_TIMEOUT_MS
    );
    return res.body;
  }

  /** PM (with coder) drafts the first plan for an issue and posts it as a comment. */
  private async triageInitialPlan(
    projectId: string,
    issue: ForgeIssue,
    instructionComments: ForgeComment[]
  ): Promise<void> {
    const pmId = this.projects.agentForRole(projectId, "pm");
    const project = this.projects.get(projectId);
    const forge = project ? this.forge.forgeForAccount(project.forgeAccountId) : null;
    if (!pmId || !project?.forgeRepo || !forge) return;
    const plan = await this.askPm(pmId, buildTriagePrompt(issue, instructionComments, null));
    const commentId = await forge.commentIssue(project.forgeRepo, issue.number, `${TRIAGE_MARKER}\n\n${plan}`);
    this.issueTriage.upsert(projectId, issue.number, plan, commentId);
  }

  /** PM (with coder) revises an issue's plan from new instruction comments. */
  private async refineIssuePlan(
    projectId: string,
    issue: ForgeIssue,
    currentPlan: string,
    instructionComments: ForgeComment[]
  ): Promise<void> {
    const pmId = this.projects.agentForRole(projectId, "pm");
    const project = this.projects.get(projectId);
    const forge = project ? this.forge.forgeForAccount(project.forgeAccountId) : null;
    if (!pmId || !project?.forgeRepo || !forge) return;
    const plan = await this.askPm(pmId, buildTriagePrompt(issue, instructionComments, currentPlan));
    const commentId = await forge.commentIssue(project.forgeRepo, issue.number, `${TRIAGE_MARKER}\n\n${plan}`);
    this.issueTriage.upsert(projectId, issue.number, plan, commentId);
  }
```

Add a module-scope prompt builder (near `buildStagePrompt`, or at the bottom of the
file with the other helpers):

```ts
/** Prompt for the PM to draft or revise a candidate plan for a forge issue. */
function buildTriagePrompt(
  issue: ForgeIssue,
  instructionComments: ForgeComment[],
  currentPlan: string | null
): string {
  const comments = instructionComments.length
    ? `\n\nClarifying comments to address:\n${instructionComments.map((c) => `- @${c.author}: ${c.body}`).join("\n")}`
    : "";
  const prior = currentPlan ? `\n\nYour current plan (revise it):\n${currentPlan}` : "";
  return (
    `Triage GitHub/Gitea issue #${issue.number}: "${issue.title}"\n\n${issue.body}${comments}${prior}\n\n` +
    `Produce a concise candidate implementation plan: which files/areas change, the ` +
    `phases, and the approach. Consult the Coder for grounding, but plan ONLY — do not ` +
    `edit code and do not launch the build pipeline. Reply with just the plan text; it ` +
    `will be posted as a comment on the issue.`
  );
}
```

Ensure `ForgeIssue` and `ForgeComment` are imported in `orchestrator.ts` from
`../forge/forge.js` (add to the existing forge import, or add a new
`import type { ForgeIssue, ForgeComment } from "../forge/forge.js";`).

- [ ] **Step 3: Wire the triage deps into the ForgeMonitor + feed the plan into builds**

In the `new ForgeMonitor({ ... })` block (lines 560-585), update `startRunFromIssue`
to include the stored plan, and add the triage deps. Replace `startRunFromIssue`:

```ts
      startRunFromIssue: (projectId, issue) => {
        const triage = this.issueTriage.get(projectId, issue.number);
        const base = `Resolve issue #${issue.number}: ${issue.title}\n\n${issue.body}`;
        const goal = triage?.plan ? `${base}\n\nAgreed plan:\n${triage.plan}` : base;
        return this.pipeline.startRun(projectId, goal, { issueNumber: issue.number });
      },
```

And add (inside the same deps object, e.g. after `resumeRun`):

```ts
      listTriageProjects: () =>
        this.projects.listTriageEnabled().map((p) => ({ id: p.id, forgeRepo: p.forgeRepo! })),
      getTriage: (projectId, issueNumber) => this.issueTriage.get(projectId, issueNumber),
      triageInitial: (projectId, issue, instr) => this.triageInitialPlan(projectId, issue, instr),
      refinePlan: (projectId, issue, plan, instr) => this.refineIssuePlan(projectId, issue, plan, instr),
      advanceWatermark: (projectId, issueNumber, lastCommentId) =>
        this.issueTriage.advanceWatermark(projectId, issueNumber, lastCommentId),
```

- [ ] **Step 4: Persist `triageIssues` in `setProjectForge`**

In `setProjectForge`, add `triageIssues` to the input type (line 1666 area) and to
both `setForge` calls. In the input type add after `monitorIssues?: boolean;`:

```ts
      triageIssues?: boolean;
```

In the `mode === "local"` branch's `setForge` (line 1674), add:

```ts
        monitorIssues: false,
        triageIssues: false,
```

In the forge-backed `setForge` (line 1717), add after `monitorIssues`:

```ts
        monitorIssues: input.monitorIssues ?? false,
        triageIssues: input.triageIssues ?? false,
```

- [ ] **Step 5: Build the server to verify everything compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: `> tsc` with no errors. (If `forgeForAccount` is the wrong name, grep
`forgeForAccount` / `forgeFor` in `forge-service.ts` and use the one that takes the
account-id used in the existing `forgeForProject` dep at line 565.)

- [ ] **Step 6: Run the whole server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts
git commit -m "feat(triage): orchestrator PM authoring, monitor deps, plan-fed build goal"
```

---

## Task 6: API + web UI

**Files:**
- Modify: `packages/server/src/server.ts`
- Modify: `packages/web/src/stores/projects-store.ts`
- Modify: `packages/web/src/components/agents/ProjectsView.tsx`

- [ ] **Step 1: Accept `triageIssues` in the forge endpoint**

In `server.ts`, in the `PUT /api/projects/:id/forge` `Body` type (line 614-621),
add after `monitorIssues?: boolean;`:

```ts
      triageIssues?: boolean;
```

No handler change is needed — `setProjectForge` already receives `{ ...req.body }`.

- [ ] **Step 2: Add `triageIssues` to the web Project type + setForge input**

In `packages/web/src/stores/projects-store.ts`, add to the `Project` interface after
`monitorIssues: boolean;` (line 17):

```ts
  triageIssues: boolean;
```

And in the `setForge` signature's input object (line 92-99), add after
`monitorIssues?: boolean;`:

```ts
      triageIssues?: boolean;
```

(The implementation already JSON-stringifies the whole input, so no body change.)

- [ ] **Step 3: Add the "Triage issues" checkbox to ProjectsView**

In `ProjectsView.tsx`, add `triageIssues` to the forge form state (line 81 area):

```ts
    monitorIssues: project.monitorIssues,
    triageIssues: project.triageIssues,
    remoteE2e: project.remoteE2e,
```

Add the checkbox right after the "Monitor issues" label (after line 198):

```tsx
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))" }}>
              <input type="checkbox" checked={forge.triageIssues} onChange={(e) => setForgeForm({ ...forge, triageIssues: e.target.checked })} />
              Triage issues → PM posts/refines a plan
            </label>
```

Include it in the `setForge` payload (line 227 area):

```ts
            monitorIssues: forge.monitorIssues,
            triageIssues: forge.triageIssues,
            remoteE2e: forge.remoteE2e,
```

- [ ] **Step 4: Build web to verify it typechecks**

Run: `pnpm --filter @otterbot/web build`
Expected: built successfully (chunk-size warning only).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server.ts packages/web/src/stores/projects-store.ts packages/web/src/components/agents/ProjectsView.tsx
git commit -m "feat(triage): triageIssues in forge API + project settings UI"
```

---

## Task 7: Full verification

- [ ] **Step 1: Server build + full tests**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/server test`
Expected: tsc clean; all tests PASS (forge, issue-triage-store, forge-monitor incl.
new triage cases).

- [ ] **Step 2: Web build**

Run: `pnpm --filter @otterbot/web build`
Expected: built successfully.

- [ ] **Step 3: Manual smoke (optional, needs a real forge account)**

With a project bound to a GitHub/Gitea repo and "Triage issues" checked:
1. Open a new issue (leave it unassigned). Within a poll cycle (≤5 min) the PM posts
   a `🦦 **otterbot plan**` comment.
2. As a maintainer or the issue author, comment a clarification → the PM posts a
   revised plan; comments from non-maintainers are ignored.
3. Assign the issue to the bot account → the build pipeline runs with the agreed plan
   appended to the goal (verify the run goal contains "Agreed plan:").

> To shorten the loop while testing, you can temporarily lower the
> `forgeMonitor.start(5 * 60_000)` interval at the boot site (do not commit that).

- [ ] **Step 4: Final commit (if anything was left uncommitted) and push**

```bash
git push origin dev
```

---

## Self-Review notes (already reconciled against the spec)

- **`triageIssues` flag** — Task 1 (schema/migration/store), Task 5 step 4 (persist),
  Task 6 (API + UI).
- **`issue_triage` table / store** — Task 1 + Task 3.
- **Forge `listOpenIssues` / `listIssueComments` / `getUserPermission` / comment id** —
  Task 2 (interface + both providers + tests).
- **Triage + refinement loop, allowlist (author OR write/admin), in-flight guard,
  watermark, fold pre-triage comments, skip assigned/PRs** — Task 4 (logic + tests)
  with authoring in Task 5.
- **PM + Coder authoring** — Task 5 `askPm` (bus request to PM; the PM persona drives
  coder consultation) + `buildTriagePrompt` (plan-only instruction).
- **Feed plan into build** — Task 5 step 3 (`startRunFromIssue`).
- **UI toggle** — Task 6.
- **Tests** — forge (Task 2), store (Task 3), monitor decision logic (Task 4),
  full-suite regression (Task 5/7).

Naming consistency check: `IssueTriageStore.get/upsert/advanceWatermark`, monitor
deps `getTriage/triageInitial/refinePlan/advanceWatermark/listTriageProjects`,
orchestrator `triageInitialPlan/refineIssuePlan/askPm`, `TriageState { plan,
lastCommentId }`, `commentIssue → number`, `TRIAGE_MARKER` — all used consistently
across tasks.
