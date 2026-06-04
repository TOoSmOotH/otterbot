import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { BuildGraphManager } from "./build-graph.js";
import { WorktreeManager } from "./worktree.js";
import { integrateSerially } from "./integrate.js";
import { makeRunTask, type BuildTaskCaps } from "./build-task-runner.js";

const git = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
};

const waitFor = async (pred: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe("build graph end-to-end on real git", () => {
  let dir: string;
  let repo: string;
  let control: ControlDb;
  let base: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bg-e2e-"));
    repo = join(dir, "repo");
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    git(repo, "config", "user.email", "t@t");
    git(repo, "config", "user.name", "t");
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-m", "base");
    base = git(repo, "branch", "--show-current");
    control = openControlDb(join(dir, "control.db"));
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs two coders in parallel worktrees, integrates serially, finishes done", async () => {
    const wm = new WorktreeManager(repo, join(dir, ".worktrees"));
    const files: Record<string, string> = { "code-a": "a.txt", "code-b": "b.txt" };

    const caps: BuildTaskCaps = {
      baseBranch: () => base,
      addWorktree: (run, task) => wm.add(run.id, task.id, base),
      dispatchCoder: async ({ task, worktreePath }) => {
        writeFileSync(join(worktreePath, files[task.id]), `${task.id}\n`);
        return `wrote ${files[task.id]}`;
      },
      commitWorktree: ({ worktreePath }) => {
        git(worktreePath, "add", "-A");
        const status = git(worktreePath, "status", "--porcelain");
        if (status === "") return { ok: false, output: "nothing to commit" };
        git(worktreePath, "commit", "-m", "work");
        return { ok: true, output: "" };
      },
      removeWorktree: (task) => wm.remove(task.id),
      coderBranches: (run) =>
        mgr
          .listTasks(run.id)
          .filter((t) => t.role === "coder")
          .map((t) => ({ taskId: t.id, branch: wm.branchName(run.id, t.id) })),
      integrate: ({ items }) => {
        git(repo, "checkout", "-B", "integration", base);
        return integrateSerially(repo, items);
      },
      runGate: async () => "VERDICT: PASS",
    };

    const mgr = new BuildGraphManager({ control, runTask: makeRunTask(caps) });
    const runId = mgr.createRun("proj1", "two files", { parallelism: 2 });
    mgr.seedTasks(runId, "proj1", [
      { id: "code-a", title: "A", role: "coder" },
      { id: "code-b", title: "B", role: "coder" },
      { id: "int", title: "integrate", role: "integrator", deps: ["code-a", "code-b"] },
    ]);
    mgr.start(runId);

    await waitFor(() => mgr.getRun(runId)?.status === "done");

    git(repo, "checkout", "integration");
    expect(existsSync(join(repo, "a.txt"))).toBe(true);
    expect(existsSync(join(repo, "b.txt"))).toBe(true);
    expect(mgr.listTasks(runId).every((t) => t.status === "merged")).toBe(true);
  });
});
