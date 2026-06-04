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
    base = git(repo, "branch", "--show-current");
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
