# Build Graph — Phase 2b: Worktrees & Serial Integrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-git primitives the build graph needs: a `WorktreeManager` that creates/removes a `git worktree` (and branch) per task, and an `integrateSerially` function that merges task branches onto the current (integration) branch one at a time behind an optional test gate, recording conflicts and test failures without aborting the whole batch.

**Architecture:** Two small, single-responsibility modules under `packages/server/src/pipeline/`, plus a shared low-level git runner. All git calls go through an injectable `GitRunner` (default: real `git` via `spawnSync`), so the modules are exercised against **real temporary git repositories** in tests — no mocking, faithful behavior. These are pure host-side primitives; wiring them into `BuildGraphManager`/the orchestrator/forge (creating a worktree when a coder task is dispatched, running the integrator as the integration step under the PM's forge credentials) is Phase 2c.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Node `child_process.spawnSync`, Vitest. Mirrors the existing git-exec pattern in `packages/server/src/projects/project-store.ts` (`spawnSync("git", ["-C", repoPath, ...args])` → `{ ok, output }`).

**Scope boundary:** No changes to `BuildGraphManager`, the orchestrator, the sandbox, the DB schema, or forge code. `integrateSerially` merges into the repo's **current** branch — the caller checks out the integration branch and decides how to react to non-`merged` outcomes (Phase 2c kicks those tasks back). Pushing/PR-opening continues to use the existing `publishRun` flow (Phase 2c).

**Pre-req:** Phases 1 + 2a merged. `git` is on PATH (the codebase already shells out to it).

---

### Task 1: Shared git runner + `WorktreeManager`

**Files:**
- Create: `packages/server/src/pipeline/git-runner.ts`
- Create: `packages/server/src/pipeline/worktree.ts`
- Test: `packages/server/src/pipeline/worktree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/pipeline/worktree.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { WorktreeManager } from "./worktree.js";

/** Run git in `cwd`, throwing on failure; returns trimmed stdout. */
const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
};

describe("WorktreeManager", () => {
  let dir: string;
  let repo: string;
  let base: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-wt-"));
    repo = join(dir, "repo");
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "base");
    base = git(repo, "branch", "--show-current"); // main or master, whatever git defaults to
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds a worktree on a new task branch carrying the base content", () => {
    const wm = new WorktreeManager(repo, join(dir, ".worktrees"));
    const wt = wm.add("run1", "taskA", base);
    expect(existsSync(wt.path)).toBe(true);
    expect(wt.branch).toBe("task/run1/taskA");
    expect(readFileSync(join(wt.path, "base.txt"), "utf8")).toBe("base\n");
    expect(git(wt.path, "branch", "--show-current")).toBe("task/run1/taskA");
  });

  it("removes a worktree and drops it from `git worktree list`", () => {
    const wm = new WorktreeManager(repo, join(dir, ".worktrees"));
    const wt = wm.add("run1", "taskA", base);
    expect(wm.list()).toContain(wt.path);
    wm.remove("taskA");
    expect(existsSync(wt.path)).toBe(false);
    expect(wm.list()).not.toContain(wt.path);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test worktree`
Expected: FAIL — cannot find module `./worktree.js` / `WorktreeManager` not exported.

- [ ] **Step 3: Create the git runner**

Create `packages/server/src/pipeline/git-runner.ts`:

```typescript
import { spawnSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  output: string;
}

/** Runs git in a repo dir and reports success + combined stdout/stderr. */
export type GitRunner = (repoPath: string, args: string[]) => GitResult;

/** Default runner: shells out to the real `git` binary (mirrors ProjectStore.git). */
export const realGit: GitRunner = (repoPath, args) => {
  const r = spawnSync("git", ["-C", repoPath, ...args], { encoding: "utf8", timeout: 120_000 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.error) return { ok: false, output: r.error.message };
  return { ok: r.status === 0, output };
};
```

- [ ] **Step 4: Create the WorktreeManager**

Create `packages/server/src/pipeline/worktree.ts`:

```typescript
import { join } from "node:path";
import { realGit, type GitRunner } from "./git-runner.js";

export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
}

/**
 * Creates and removes one git worktree (and its branch) per build-graph task, so
 * parallel coders edit isolated checkouts of the same repo. Worktrees live under
 * `<worktreeRoot>/<taskId>`; the branch is `task/<runId>/<taskId>`.
 */
export class WorktreeManager {
  constructor(
    private readonly repoPath: string,
    private readonly worktreeRoot: string,
    private readonly git: GitRunner = realGit
  ) {}

  branchName(runId: string, taskId: string): string {
    return `task/${runId}/${taskId}`;
  }

  /** Create a worktree for a task, branched off `baseBranch`. */
  add(runId: string, taskId: string, baseBranch: string): WorktreeInfo {
    const branch = this.branchName(runId, taskId);
    const path = join(this.worktreeRoot, taskId);
    const r = this.git(this.repoPath, ["worktree", "add", "-b", branch, path, baseBranch]);
    if (!r.ok) throw new Error(`worktree add failed for ${taskId}: ${r.output}`);
    return { taskId, path, branch };
  }

  /** Remove a task's worktree (force: drop even if it has uncommitted changes). */
  remove(taskId: string): void {
    const path = join(this.worktreeRoot, taskId);
    this.git(this.repoPath, ["worktree", "remove", "--force", path]);
  }

  /** Absolute paths of the repo's current worktrees (includes the main checkout). */
  list(): string[] {
    const r = this.git(this.repoPath, ["worktree", "list", "--porcelain"]);
    if (!r.ok) return [];
    return r.output
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim());
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test worktree`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/pipeline/git-runner.ts packages/server/src/pipeline/worktree.ts packages/server/src/pipeline/worktree.test.ts
git commit -m "feat(build-graph): WorktreeManager for per-task git worktrees"
```

---

### Task 2: `integrateSerially` — merge disjoint branches (happy path)

**Files:**
- Create: `packages/server/src/pipeline/integrate.ts`
- Test: `packages/server/src/pipeline/integrate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/pipeline/integrate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { integrateSerially } from "./integrate.js";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
};

let dir: string;
let repo: string;
let base: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "otter-int-"));
  repo = join(dir, "repo");
  spawnSync("git", ["init", repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "t@t");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "base");
  base = git(repo, "branch", "--show-current");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Create a branch off base that adds `file` with `content`, then return to base. */
const branchAdding = (branch: string, file: string, content: string) => {
  git(repo, "checkout", "-b", branch, base);
  writeFileSync(join(repo, file), content);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", `add ${file}`);
  git(repo, "checkout", base);
};

describe("integrateSerially", () => {
  it("merges disjoint branches onto the current branch", () => {
    branchAdding("task/r/a", "a.txt", "A\n");
    branchAdding("task/r/b", "b.txt", "B\n");
    git(repo, "checkout", "-b", "integration", base);

    const out = integrateSerially(repo, [
      { taskId: "a", branch: "task/r/a" },
      { taskId: "b", branch: "task/r/b" },
    ]);

    expect(out.map((o) => o.result)).toEqual(["merged", "merged"]);
    expect(existsSync(join(repo, "a.txt"))).toBe(true);
    expect(existsSync(join(repo, "b.txt"))).toBe(true);
    expect(git(repo, "status", "--porcelain")).toBe(""); // clean tree
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: FAIL — cannot find module `./integrate.js`.

- [ ] **Step 3: Create `integrate.ts` (minimal merge loop)**

Create `packages/server/src/pipeline/integrate.ts`:

```typescript
import { realGit, type GitRunner } from "./git-runner.js";

export interface IntegrationItem {
  taskId: string;
  branch: string;
}

/** Runs the project's test gate in a repo dir; ok=false fails the gate. */
export type TestRunner = (repoPath: string) => { ok: boolean; output: string };

export type MergeResult = "merged" | "conflict" | "test-failed";

export interface MergeOutcome {
  taskId: string;
  branch: string;
  result: MergeResult;
  output: string;
}

/**
 * Merge each item's branch into the repo's CURRENT branch, one at a time (serial
 * integration). Conflicts and failing test gates are recorded per-item and skip
 * to the next item rather than aborting the batch. The caller checks out the
 * integration branch first and decides how to react to non-`merged` outcomes
 * (kick the task back to its coder).
 */
export function integrateSerially(
  repoPath: string,
  items: IntegrationItem[],
  opts: { git?: GitRunner; runTests?: TestRunner } = {}
): MergeOutcome[] {
  const git = opts.git ?? realGit;
  const outcomes: MergeOutcome[] = [];
  for (const item of items) {
    const merge = git(repoPath, ["merge", "--no-ff", "-m", `integrate ${item.taskId}`, item.branch]);
    outcomes.push({ taskId: item.taskId, branch: item.branch, result: "merged", output: merge.output });
  }
  return outcomes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/integrate.ts packages/server/src/pipeline/integrate.test.ts
git commit -m "feat(build-graph): serial integrator merges disjoint branches"
```

---

### Task 3: `integrateSerially` — abort and record conflicts

**Files:**
- Modify: `packages/server/src/pipeline/integrate.ts`
- Test: `packages/server/src/pipeline/integrate.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("integrateSerially", ...)` block in `integrate.test.ts`:

```typescript
  it("aborts a conflicting merge, records it, leaves a clean tree, and continues", () => {
    // Both branches edit base.txt differently → second merge conflicts.
    git(repo, "checkout", "-b", "task/r/a", base);
    writeFileSync(join(repo, "base.txt"), "A\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "a edits base");
    git(repo, "checkout", base);
    git(repo, "checkout", "-b", "task/r/b", base);
    writeFileSync(join(repo, "base.txt"), "B\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "b edits base");
    git(repo, "checkout", "-b", "integration", base);

    const out = integrateSerially(repo, [
      { taskId: "a", branch: "task/r/a" },
      { taskId: "b", branch: "task/r/b" },
    ]);

    expect(out[0].result).toBe("merged");
    expect(out[1].result).toBe("conflict");
    expect(git(repo, "status", "--porcelain")).toBe(""); // no half-finished merge
    // a's change is integrated; b's conflicting change is not
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(repo, "base.txt"), "utf8")).toBe("A\n");
  });
```

NOTE: the `await import` inside a non-async test won't work — make this test callback `async` (change `() => {` to `async () => {`), OR add `import { readFileSync } from "node:fs";` to the top of the file and drop the dynamic import. Prefer adding `readFileSync` to the existing top-of-file `node:fs` import (`import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";`) and using it directly.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: FAIL — the minimal loop reports `"merged"` for the conflicting branch (and likely leaves a dirty/conflicted tree), so `out[1].result` is `"merged"`, not `"conflict"`.

- [ ] **Step 3: Add conflict handling**

In `integrate.ts`, replace the loop body in `integrateSerially` with:

```typescript
  for (const item of items) {
    const merge = git(repoPath, ["merge", "--no-ff", "-m", `integrate ${item.taskId}`, item.branch]);
    if (!merge.ok) {
      git(repoPath, ["merge", "--abort"]);
      outcomes.push({ taskId: item.taskId, branch: item.branch, result: "conflict", output: merge.output });
      continue;
    }
    outcomes.push({ taskId: item.taskId, branch: item.branch, result: "merged", output: merge.output });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/integrate.ts packages/server/src/pipeline/integrate.test.ts
git commit -m "feat(build-graph): serial integrator aborts and records merge conflicts"
```

---

### Task 4: `integrateSerially` — roll back a merge whose test gate fails

**Files:**
- Modify: `packages/server/src/pipeline/integrate.ts`
- Test: `packages/server/src/pipeline/integrate.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("integrateSerially", ...)` block in `integrate.test.ts`:

```typescript
  it("rolls back a merge whose test gate fails and records test-failed", () => {
    branchAdding("task/r/a", "bad.txt", "boom\n");
    git(repo, "checkout", "-b", "integration", base);

    // Test gate fails whenever bad.txt is present in the working tree.
    const runTests = (rp: string) => ({
      ok: !existsSync(join(rp, "bad.txt")),
      output: existsSync(join(rp, "bad.txt")) ? "bad.txt present" : "ok",
    });

    const out = integrateSerially(repo, [{ taskId: "a", branch: "task/r/a" }], { runTests });

    expect(out[0].result).toBe("test-failed");
    expect(existsSync(join(repo, "bad.txt"))).toBe(false); // merge rolled back
    expect(git(repo, "status", "--porcelain")).toBe(""); // clean tree
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: FAIL — without a test gate the merge stays, so `out[0].result` is `"merged"` and `bad.txt` is still present.

- [ ] **Step 3: Add the test-gate + rollback**

In `integrate.ts`, update the loop so that after a successful merge it runs the optional test gate and rolls back on failure. The full loop body becomes:

```typescript
  for (const item of items) {
    const merge = git(repoPath, ["merge", "--no-ff", "-m", `integrate ${item.taskId}`, item.branch]);
    if (!merge.ok) {
      git(repoPath, ["merge", "--abort"]);
      outcomes.push({ taskId: item.taskId, branch: item.branch, result: "conflict", output: merge.output });
      continue;
    }
    if (opts.runTests) {
      const test = opts.runTests(repoPath);
      if (!test.ok) {
        git(repoPath, ["reset", "--hard", "HEAD~1"]); // undo the --no-ff merge commit
        outcomes.push({ taskId: item.taskId, branch: item.branch, result: "test-failed", output: test.output });
        continue;
      }
    }
    outcomes.push({ taskId: item.taskId, branch: item.branch, result: "merged", output: merge.output });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test integrate`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/pipeline/integrate.ts packages/server/src/pipeline/integrate.test.ts
git commit -m "feat(build-graph): serial integrator runs a test gate and rolls back failures"
```

---

### Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS — all suites green, including the new `worktree` and `integrate` suites and every prior build-graph + pre-existing suite.

- [ ] **Step 2: Type-check the server build**

Run: `pnpm --filter @otterbot/server build`
Expected: `tsc` completes with no errors.

---

## Self-Review

**Spec coverage (Phase 2 "git worktree per task" + "serial integrator" slice):**
- Worktree per task (`task/<runId>/<taskId>` under `<worktreeRoot>/<taskId>`), create + remove + list → Task 1. ✓
- Serial integration: merge task branches one at a time onto the integration branch → Tasks 2–4. ✓
- Conflict → record + clean tree (caller kicks back) → Task 3. ✓
- Test gate after each merge, rollback on failure → Task 4. ✓
- Injectable `GitRunner`/`TestRunner` keeps it unit-testable against real temp repos. ✓
- **Deferred to Phase 2c (intentional):** wiring worktree creation into coder-task dispatch in `BuildGraphManager`; running `integrateSerially` as the integration step under the PM's forge credentials; reacting to `conflict`/`test-failed` outcomes by kicking tasks back; binding worktrees into the sandbox; push/PR via the existing `publishRun`. **Phase 3:** transcripts + UI.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every test step shows the full test, the exact run command, and expected result. The one prose caveat (Task 3's `readFileSync` import) is explicit and actionable, not a placeholder.

**Type consistency:** `GitResult`/`GitRunner`/`realGit` are defined once in `git-runner.ts` (Task 1) and imported by both `worktree.ts` and `integrate.ts`. `WorktreeInfo`, `IntegrationItem`, `TestRunner`, `MergeResult`, `MergeOutcome` are each defined once and used consistently. `integrateSerially`'s signature `(repoPath, items, { git?, runTests? })` is stable across Tasks 2–4 (the loop body grows; the signature does not).
