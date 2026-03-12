import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WorkspaceManager } from "./workspace.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createWorktree, removeWorktree } from "../utils/git.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../utils/git.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

describe("WorkspaceManager", () => {
  let tmpDir: string;
  let ws: WorkspaceManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-test-"));
    ws = new WorkspaceManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("createProject", () => {
    it("creates the project directory structure", () => {
      ws.createProject("proj-1");
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "specs"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "docs"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "shared", "artifacts"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "agents"))).toBe(true);
      expect(existsSync(join(tmpDir, "projects", "proj-1", "repo"))).toBe(true);
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

    it("allows team leads to access the repo directory", () => {
      const repoFile = ws.repoPath("proj-1") + "/README.md";
      expect(
        ws.validateAccess(repoFile, "lead-1", "team_lead" as any, "proj-1"),
      ).toBe(true);
    });

    it("allows workers to access the repo directory", () => {
      const repoFile = ws.repoPath("proj-1") + "/README.md";
      expect(ws.validateAccess(repoFile, "agent-1", "worker" as any, "proj-1")).toBe(true);
    });
  });

  describe("path helpers", () => {
    it("returns correct repo path", () => {
      expect(ws.repoPath("proj-1")).toBe(join(tmpDir, "projects", "proj-1", "repo"));
    });

  });

  describe("prepareAgentWorktree", () => {
    it("uses execFileSync with argument array in fork mode, preventing shell injection", () => {
      ws.createProject("proj-1");

      const maliciousBranch = '$(rm -rf /)';
      ws.prepareAgentWorktree("proj-1", "agent-1", undefined, {
        forkMode: true,
        upstreamBranch: maliciousBranch,
      });

      expect(createWorktree).toHaveBeenCalledOnce();
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["reset", "--hard", `upstream/${maliciousBranch}`],
        expect.objectContaining({
          stdio: "ignore",
          timeout: 30_000,
        }),
      );
    });

    it("does not call execFileSync when forkMode is false", () => {
      ws.createProject("proj-1");

      ws.prepareAgentWorktree("proj-1", "agent-1");

      expect(createWorktree).toHaveBeenCalledOnce();
      expect(execFileSync).not.toHaveBeenCalled();
    });
  });
});
