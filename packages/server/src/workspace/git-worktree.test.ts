import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GitWorktreeManager } from "./git-worktree.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

describe("GitWorktreeManager", () => {
  let tmpDir: string;
  let gw: GitWorktreeManager;
  let repoPath: string;
  let worktreesDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "smoothbot-gw-test-"));
    repoPath = join(tmpDir, "repo");
    worktreesDir = join(tmpDir, "worktrees");
    gw = new GitWorktreeManager(repoPath, worktreesDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("initRepo / hasRepo", () => {
    it("initializes a git repo with main branch", () => {
      expect(gw.hasRepo()).toBe(false);
      gw.initRepo();
      expect(gw.hasRepo()).toBe(true);
      expect(existsSync(join(repoPath, ".git"))).toBe(true);
    });
  });

  describe("createWorktree", () => {
    it("creates a worktree directory with a worker branch", () => {
      gw.initRepo();
      const info = gw.createWorktree("agent-1");

      expect(info.agentId).toBe("agent-1");
      expect(info.branchName).toBe("worker/agent-1");
      expect(info.worktreePath).toBe(resolve(worktreesDir, "agent-1"));
      expect(existsSync(info.worktreePath)).toBe(true);
    });

    it("creates multiple independent worktrees", () => {
      gw.initRepo();
      const w1 = gw.createWorktree("agent-1");
      const w2 = gw.createWorktree("agent-2");

      expect(existsSync(w1.worktreePath)).toBe(true);
      expect(existsSync(w2.worktreePath)).toBe(true);
      expect(w1.branchName).not.toBe(w2.branchName);
    });
  });

  describe("mergeBranch", () => {
    it("merges non-overlapping changes into main", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      gw.createWorktree("agent-2");

      // Worker 1 writes file-a
      writeFileSync(join(worktreesDir, "agent-1", "file-a.txt"), "hello from agent 1");
      // Worker 2 writes file-b
      writeFileSync(join(worktreesDir, "agent-2", "file-b.txt"), "hello from agent 2");

      const r1 = gw.mergeBranch("agent-1");
      expect(r1.success).toBe(true);

      const r2 = gw.mergeBranch("agent-2");
      expect(r2.success).toBe(true);

      // Main should have both files
      expect(readFileSync(join(repoPath, "file-a.txt"), "utf-8")).toBe("hello from agent 1");
      expect(readFileSync(join(repoPath, "file-b.txt"), "utf-8")).toBe("hello from agent 2");
    });

    it("returns nothing-to-merge when branch has no changes", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");

      const result = gw.mergeBranch("agent-1");
      expect(result.success).toBe(true);
      expect(result.message).toContain("Nothing to merge");
    });

    it("detects merge conflicts", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      gw.createWorktree("agent-2");

      // Both workers edit the same file with different content
      writeFileSync(join(worktreesDir, "agent-1", "shared.txt"), "version A");
      writeFileSync(join(worktreesDir, "agent-2", "shared.txt"), "version B");

      // First merge succeeds
      const r1 = gw.mergeBranch("agent-1");
      expect(r1.success).toBe(true);

      // Second merge conflicts
      const r2 = gw.mergeBranch("agent-2");
      expect(r2.success).toBe(false);
      expect(r2.message).toContain("conflict");
    });
  });

  describe("updateWorktree", () => {
    it("rebases a worktree onto updated main", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      gw.createWorktree("agent-2");

      // Agent 1 writes and merges
      writeFileSync(join(worktreesDir, "agent-1", "base.txt"), "base content");
      gw.mergeBranch("agent-1");

      // Agent 2 syncs to get agent-1's changes
      const result = gw.updateWorktree("agent-2");
      expect(result.success).toBe(true);

      // Agent 2's worktree now has the file from agent-1's merge
      expect(readFileSync(join(worktreesDir, "agent-2", "base.txt"), "utf-8")).toBe("base content");
    });
  });

  describe("destroyWorktree", () => {
    it("removes the worktree and branch", () => {
      gw.initRepo();
      const info = gw.createWorktree("agent-1");

      expect(existsSync(info.worktreePath)).toBe(true);
      gw.destroyWorktree("agent-1");
      expect(existsSync(info.worktreePath)).toBe(false);
    });

    it("is idempotent — no error if already destroyed", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      gw.destroyWorktree("agent-1");
      expect(() => gw.destroyWorktree("agent-1")).not.toThrow();
    });
  });

  describe("getBranchDiff / getBranchStatus", () => {
    it("shows diff for modified worktree", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      writeFileSync(join(worktreesDir, "agent-1", "new.txt"), "new file");

      // Before commit, status shows untracked
      const status = gw.getBranchStatus("agent-1");
      expect(status).toContain("new.txt");

      // After commit, diff shows the change vs main
      gw.commit(join(worktreesDir, "agent-1"), "add new file");
      const diff = gw.getBranchDiff("agent-1");
      expect(diff).toContain("new.txt");
    });
  });

  describe("listWorktrees / getWorktree", () => {
    it("lists all active worktrees", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      gw.createWorktree("agent-2");

      const list = gw.listWorktrees();
      expect(list).toHaveLength(2);
      expect(list.map((w) => w.agentId).sort()).toEqual(["agent-1", "agent-2"]);
    });

    it("returns null for non-existent worktree", () => {
      gw.initRepo();
      expect(gw.getWorktree("nonexistent")).toBeNull();
    });

    it("returns info for existing worktree", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      const info = gw.getWorktree("agent-1");
      expect(info).not.toBeNull();
      expect(info!.branchName).toBe("worker/agent-1");
    });
  });

  describe("commit", () => {
    it("commits changes and returns true", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");
      writeFileSync(join(worktreesDir, "agent-1", "file.txt"), "content");

      const committed = gw.commit(join(worktreesDir, "agent-1"), "test commit");
      expect(committed).toBe(true);
    });

    it("returns false when nothing to commit", () => {
      gw.initRepo();
      gw.createWorktree("agent-1");

      const committed = gw.commit(join(worktreesDir, "agent-1"), "empty");
      expect(committed).toBe(false);
    });
  });

  describe("integration: full lifecycle", () => {
    it("create → write → merge → cleanup", () => {
      gw.initRepo();

      // Spawn two workers
      const w1 = gw.createWorktree("worker-a");
      const w2 = gw.createWorktree("worker-b");

      // Workers write non-overlapping files
      writeFileSync(join(w1.worktreePath, "schema.sql"), "CREATE TABLE users;");
      writeFileSync(join(w2.worktreePath, "routes.ts"), "export default router;");

      // Merge worker-a first (foundational)
      const m1 = gw.mergeBranch("worker-a");
      expect(m1.success).toBe(true);

      // Sync worker-b to get schema
      const sync = gw.updateWorktree("worker-b");
      expect(sync.success).toBe(true);
      expect(existsSync(join(w2.worktreePath, "schema.sql"))).toBe(true);

      // Merge worker-b
      const m2 = gw.mergeBranch("worker-b");
      expect(m2.success).toBe(true);

      // Main has everything
      expect(readFileSync(join(repoPath, "schema.sql"), "utf-8")).toBe("CREATE TABLE users;");
      expect(readFileSync(join(repoPath, "routes.ts"), "utf-8")).toBe("export default router;");

      // Cleanup
      gw.destroyWorktree("worker-a");
      gw.destroyWorktree("worker-b");
      expect(gw.listWorktrees()).toHaveLength(0);
    });
  });
});
