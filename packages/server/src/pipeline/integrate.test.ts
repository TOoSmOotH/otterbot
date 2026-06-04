import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
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
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

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
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(repo, "base.txt"), "utf8")).toBe("A\n");
  });

  it("rolls back a merge whose test gate fails and records test-failed", () => {
    branchAdding("task/r/a", "bad.txt", "boom\n");
    git(repo, "checkout", "-b", "integration", base);

    const runTests = (rp: string) => ({
      ok: !existsSync(join(rp, "bad.txt")),
      output: existsSync(join(rp, "bad.txt")) ? "bad.txt present" : "ok",
    });

    const out = integrateSerially(repo, [{ taskId: "a", branch: "task/r/a" }], { runTests });

    expect(out[0].result).toBe("test-failed");
    expect(existsSync(join(repo, "bad.txt"))).toBe(false);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});
