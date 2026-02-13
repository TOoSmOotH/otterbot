import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceManager } from "./workspace.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("WorkspaceManager", () => {
  let tmpDir: string;
  let ws: WorkspaceManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "smoothbot-test-"));
    ws = new WorkspaceManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("createProject", () => {
    it("creates the project directory structure", () => {
      ws.createProject("proj-1");
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "specs"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "docs"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "artifacts"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "agents"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "repo"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "worktrees"))).toBe(true);
    });
  });

  describe("createAgentWorkspace", () => {
    it("creates a private agent directory", () => {
      ws.createProject("proj-1");
      ws.createAgentWorkspace("proj-1", "agent-1");
      expect(existsSync(join(tmpDir, "projects", "proj-1", "agents", "agent-1"))).toBe(true);
    });
  });

  describe("safePath", () => {
    it("allows paths within root", () => {
      const result = ws.safePath("projects/proj-1/shared/file.txt");
      expect(result).toBe(join(tmpDir, "projects", "proj-1", "shared", "file.txt"));
    });

    it("rejects directory traversal", () => {
      expect(ws.safePath("../../../etc/passwd")).toBeNull();
    });

    it("rejects traversal with encoded segments", () => {
      expect(ws.safePath("projects/../../etc/passwd")).toBeNull();
    });
  });

  describe("validateAccess", () => {
    it("allows workers to access their own workspace", () => {
      const ownPath = ws.agentPath("proj-1", "agent-1") + "/file.txt";
      expect(ws.validateAccess(ownPath, "agent-1", "worker" as any, "proj-1")).toBe(true);
    });

    it("allows workers to access shared directory", () => {
      const sharedPath = ws.sharedPath("proj-1") + "/docs/readme.md";
      expect(ws.validateAccess(sharedPath, "agent-1", "worker" as any, "proj-1")).toBe(true);
    });

    it("denies workers access to other agents' workspaces", () => {
      const otherPath = ws.agentPath("proj-1", "agent-2") + "/file.txt";
      expect(ws.validateAccess(otherPath, "agent-1", "worker" as any, "proj-1")).toBe(false);
    });

    it("allows team leads to read their workers' workspaces", () => {
      const workerPath = ws.agentPath("proj-1", "worker-1") + "/file.txt";
      expect(
        ws.validateAccess(workerPath, "lead-1", "team_lead" as any, "proj-1", ["worker-1", "worker-2"]),
      ).toBe(true);
    });

    it("denies team leads access to non-child agent workspaces", () => {
      const otherPath = ws.agentPath("proj-1", "other-agent") + "/file.txt";
      expect(
        ws.validateAccess(otherPath, "lead-1", "team_lead" as any, "proj-1", ["worker-1"]),
      ).toBe(false);
    });

    it("denies access to other projects", () => {
      const otherProjectPath = ws.agentPath("proj-2", "agent-1") + "/file.txt";
      expect(ws.validateAccess(otherProjectPath, "agent-1", "worker" as any, "proj-1")).toBe(false);
    });

    it("rejects directory traversal in access check", () => {
      const traversalPath = ws.agentPath("proj-1", "agent-1") + "/../../other-agent/file.txt";
      // After normalize, this would be agents/other-agent/file.txt which is outside own workspace
      expect(ws.validateAccess(traversalPath, "agent-1", "worker" as any, "proj-1")).toBe(false);
    });

    it("allows workers to access their own worktree", () => {
      const wtPath = ws.worktreePath("proj-1", "agent-1") + "/src/index.ts";
      expect(ws.validateAccess(wtPath, "agent-1", "worker" as any, "proj-1")).toBe(true);
    });

    it("denies workers access to other agents' worktrees", () => {
      const wtPath = ws.worktreePath("proj-1", "agent-2") + "/src/index.ts";
      expect(ws.validateAccess(wtPath, "agent-1", "worker" as any, "proj-1")).toBe(false);
    });

    it("allows team leads to read their workers' worktrees", () => {
      const wtPath = ws.worktreePath("proj-1", "worker-1") + "/file.txt";
      expect(
        ws.validateAccess(wtPath, "lead-1", "team_lead" as any, "proj-1", ["worker-1"]),
      ).toBe(true);
    });

    it("allows team leads to access the repo directory", () => {
      const repoFile = ws.repoPath("proj-1") + "/README.md";
      expect(
        ws.validateAccess(repoFile, "lead-1", "team_lead" as any, "proj-1"),
      ).toBe(true);
    });

    it("denies workers access to the repo directory", () => {
      const repoFile = ws.repoPath("proj-1") + "/README.md";
      expect(ws.validateAccess(repoFile, "agent-1", "worker" as any, "proj-1")).toBe(false);
    });
  });

  describe("path helpers", () => {
    it("returns correct repo path", () => {
      expect(ws.repoPath("proj-1")).toBe(join(tmpDir, "projects", "proj-1", "repo"));
    });

    it("returns correct worktrees base path", () => {
      expect(ws.worktreesBasePath("proj-1")).toBe(join(tmpDir, "projects", "proj-1", "worktrees"));
    });

    it("returns correct worktree path for an agent", () => {
      expect(ws.worktreePath("proj-1", "agent-1")).toBe(
        join(tmpDir, "projects", "proj-1", "worktrees", "agent-1"),
      );
    });
  });
});
