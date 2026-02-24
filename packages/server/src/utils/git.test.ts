
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  isGitRepo,
  initGitRepo,
  hasCommits,
  createInitialCommit,
  createWorktree,
  removeWorktree,
  getCommitHash,
  parseNumstat,
  findMergeBase,
  computeGitDiff,
} from "./git.js";

const TEST_DIR = join(process.cwd(), "test-git-utils");
const REPO_DIR = join(TEST_DIR, "repo");
const WORKTREE_DIR = join(TEST_DIR, "worktrees", "agent-1");

describe("git utils", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(REPO_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "worktrees"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("isGitRepo returns false for non-git directory", () => {
    expect(isGitRepo(REPO_DIR)).toBe(false);
  });

  it("initGitRepo initializes a git repo", () => {
    initGitRepo(REPO_DIR);
    expect(isGitRepo(REPO_DIR)).toBe(true);
    expect(existsSync(join(REPO_DIR, ".git"))).toBe(true);
  });

  it("hasCommits returns false for empty repo", () => {
    initGitRepo(REPO_DIR);
    expect(hasCommits(REPO_DIR)).toBe(false);
  });

  it("createInitialCommit creates a commit", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);
    expect(hasCommits(REPO_DIR)).toBe(true);
    expect(existsSync(join(REPO_DIR, "README.md"))).toBe(true);
  });

  it("createWorktree creates a worktree", () => {
    createWorktree(REPO_DIR, WORKTREE_DIR, "agent-1");

    expect(existsSync(WORKTREE_DIR)).toBe(true);
    expect(existsSync(join(WORKTREE_DIR, ".git"))).toBe(true); // .git file pointing to worktree
    expect(existsSync(join(WORKTREE_DIR, "README.md"))).toBe(true);

    // Verify branch is checked out
    const branch = execSync("git branch --show-current", { cwd: WORKTREE_DIR, encoding: "utf-8" }).trim();
    expect(branch).toBe("agent-1");
  });

  it("createWorktree handles existing directory/worktree", () => {
    // First creation
    createWorktree(REPO_DIR, WORKTREE_DIR, "agent-1");
    expect(existsSync(WORKTREE_DIR)).toBe(true);

    // Modify file in first worktree
    writeFileSync(join(WORKTREE_DIR, "test.txt"), "hello");
    execSync("git add . && git commit -m 'agent work'", { cwd: WORKTREE_DIR });

    // Second creation (should reset/recreate)
    createWorktree(REPO_DIR, WORKTREE_DIR, "agent-1");

    // It should succeed and be clean (reset to HEAD of main repo which doesn't have test.txt)
    // Wait, createWorktree uses HEAD of the repo.
    // If the branch "agent-1" existed and had commits, 'git worktree add -B agent-1' resets it to HEAD.
    // So test.txt should be gone from the branch (or rather, the branch is reset to main's HEAD).

    expect(existsSync(WORKTREE_DIR)).toBe(true);
    expect(existsSync(join(WORKTREE_DIR, "test.txt"))).toBe(false);
  });

  it("removeWorktree removes the worktree", () => {
    createWorktree(REPO_DIR, WORKTREE_DIR, "agent-1");
    expect(existsSync(WORKTREE_DIR)).toBe(true);

    removeWorktree(REPO_DIR, WORKTREE_DIR);
    expect(existsSync(WORKTREE_DIR)).toBe(false);

    // Verify it's pruned
    const worktrees = execSync("git worktree list", { cwd: REPO_DIR, encoding: "utf-8" });
    expect(worktrees).not.toContain(WORKTREE_DIR);
  });

  it("getCommitHash returns hash", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);
    const hash = getCommitHash(REPO_DIR);
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("parseNumstat", () => {
  it("parses standard numstat output", () => {
    const output = "10\t5\tsrc/index.ts\n3\t1\tREADME.md";
    const files = parseNumstat(output);
    expect(files).toEqual([
      { path: "src/index.ts", additions: 10, deletions: 5 },
      { path: "README.md", additions: 3, deletions: 1 },
    ]);
  });

  it("returns empty array for empty output", () => {
    expect(parseNumstat("")).toEqual([]);
  });

  it("skips malformed lines with fewer than 3 tab-separated parts", () => {
    const output = "10\t5\tsrc/index.ts\nsome garbage line\n3\t1\tREADME.md";
    const files = parseNumstat(output);
    expect(files).toEqual([
      { path: "src/index.ts", additions: 10, deletions: 5 },
      { path: "README.md", additions: 3, deletions: 1 },
    ]);
  });

  it("handles binary files (- markers)", () => {
    const output = "-\t-\timage.png";
    const files = parseNumstat(output);
    expect(files).toEqual([
      { path: "image.png", additions: 0, deletions: 0 },
    ]);
  });
});

describe("computeGitDiff", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(REPO_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("returns null when there are no changes", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);
    const result = computeGitDiff(REPO_DIR);
    expect(result).toBeNull();
  });

  it("detects uncommitted changes", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);
    writeFileSync(join(REPO_DIR, "new-file.txt"), "hello world");
    execSync("git add .", { cwd: REPO_DIR });

    const result = computeGitDiff(REPO_DIR);
    expect(result).not.toBeNull();
    expect(result!.files.length).toBeGreaterThanOrEqual(1);
    expect(result!.files.some((f) => f.path === "new-file.txt")).toBe(true);
  });

  it("detects committed changes on a branch", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);

    // Create a branch and commit changes
    execSync("git checkout -b feature-branch", { cwd: REPO_DIR, stdio: "ignore" });
    writeFileSync(join(REPO_DIR, "feature.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'add feature'", { cwd: REPO_DIR, stdio: "ignore" });

    // Set up a fake remote so findMergeBase can find the branch point
    // We simulate by creating a local ref that acts like origin/main
    const mainHash = execSync("git rev-parse main", { cwd: REPO_DIR, encoding: "utf-8" }).trim();
    execSync(`git update-ref refs/remotes/origin/main ${mainHash}`, { cwd: REPO_DIR, stdio: "ignore" });

    const result = computeGitDiff(REPO_DIR);
    expect(result).not.toBeNull();
    expect(result!.files.some((f) => f.path === "feature.ts")).toBe(true);
  });

  it("detects both committed and uncommitted changes", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);

    // Create a branch and commit
    execSync("git checkout -b feature-branch", { cwd: REPO_DIR, stdio: "ignore" });
    writeFileSync(join(REPO_DIR, "committed.ts"), "export const x = 1;");
    execSync("git add . && git commit -m 'committed change'", { cwd: REPO_DIR, stdio: "ignore" });

    // Also make an uncommitted change
    writeFileSync(join(REPO_DIR, "uncommitted.ts"), "export const y = 2;");
    execSync("git add .", { cwd: REPO_DIR, stdio: "ignore" });

    // Set up fake origin/main ref
    const mainHash = execSync("git rev-parse main", { cwd: REPO_DIR, encoding: "utf-8" }).trim();
    execSync(`git update-ref refs/remotes/origin/main ${mainHash}`, { cwd: REPO_DIR, stdio: "ignore" });

    const result = computeGitDiff(REPO_DIR);
    expect(result).not.toBeNull();
    const paths = result!.files.map((f) => f.path);
    expect(paths).toContain("committed.ts");
    expect(paths).toContain("uncommitted.ts");
  });

  it("falls back gracefully when no remote refs exist", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);

    // Commit a change with no remote refs at all
    writeFileSync(join(REPO_DIR, "local.ts"), "local only");
    execSync("git add . && git commit -m 'local'", { cwd: REPO_DIR, stdio: "ignore" });

    // findMergeBase will return null, but uncommitted diff should still work
    // (no uncommitted changes here, and no merge-base, so result is null)
    const result = computeGitDiff(REPO_DIR);
    expect(result).toBeNull();
  });
});

describe("findMergeBase", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(REPO_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("returns null when no remote refs exist", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);
    const result = findMergeBase(REPO_DIR);
    expect(result).toBeNull();
  });

  it("finds merge-base with origin/main", () => {
    initGitRepo(REPO_DIR);
    createInitialCommit(REPO_DIR);

    const mainHash = execSync("git rev-parse HEAD", { cwd: REPO_DIR, encoding: "utf-8" }).trim();
    execSync(`git update-ref refs/remotes/origin/main ${mainHash}`, { cwd: REPO_DIR, stdio: "ignore" });

    execSync("git checkout -b feature", { cwd: REPO_DIR, stdio: "ignore" });
    writeFileSync(join(REPO_DIR, "f.txt"), "f");
    execSync("git add . && git commit -m 'f'", { cwd: REPO_DIR, stdio: "ignore" });

    const base = findMergeBase(REPO_DIR);
    expect(base).toBe(mainHash);
  });
});
