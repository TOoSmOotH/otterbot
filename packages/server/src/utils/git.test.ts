
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
