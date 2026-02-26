import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

// Mock auth
const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock github-service
const mockFetchAssignedIssues = vi.fn().mockResolvedValue([]);
const mockCreateIssueComment = vi.fn().mockResolvedValue({
  id: 1,
  user: { login: "otterbot" },
  body: "",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  html_url: "",
});
const mockFetchOpenIssues = vi.fn().mockResolvedValue([]);
const mockCheckHasTriageAccess = vi.fn().mockResolvedValue(true);
vi.mock("../github-service.js", () => ({
  fetchAssignedIssues: (...args: any[]) => mockFetchAssignedIssues(...args),
  fetchOpenIssues: (...args: any[]) => mockFetchOpenIssues(...args),
  createIssueComment: (...args: any[]) => mockCreateIssueComment(...args),
  addLabelsToIssue: vi.fn().mockResolvedValue(undefined),
  checkHasTriageAccess: (...args: any[]) => mockCheckHasTriageAccess(...args),
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

import { GitHubIssueMonitor } from "../issue-monitor.js";
import type { PipelineManager } from "../../pipeline/pipeline-manager.js";

// Create mock COO
function createMockCoo() {
  const teamLeads = new Map<string, { id: string }>();
  return {
    getTeamLeads: vi.fn(() => teamLeads),
    bus: {
      send: vi.fn(() => ({
        id: "msg-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: "directive",
        content: "",
        timestamp: new Date().toISOString(),
      })),
    },
    _teamLeads: teamLeads,
  };
}

// Create mock socket.io server
function createMockIo() {
  return {
    emit: vi.fn(),
  };
}

function createMockPipelineManager() {
  return {
    isEnabled: vi.fn((projectId: string) => {
      const config = configStore.get(`project:${projectId}:pipeline-config`);
      if (!config) return false;
      const parsed = JSON.parse(config);
      return parsed.enabled === true;
    }),
    getConfig: vi.fn((projectId: string) => {
      const config = configStore.get(`project:${projectId}:pipeline-config`);
      if (!config) return null;
      return JSON.parse(config);
    }),
    createTriageTask: vi.fn(),
    runTriage: vi.fn(),
    createTask: vi.fn(),
  } as unknown as PipelineManager;
}

function setPipelineConfig(projectId: string, stageOverrides: Record<string, { enabled?: boolean; agentId?: string }> = {}) {
  const config = {
    enabled: true,
    stages: {
      triage: { enabled: false, ...stageOverrides.triage },
      coder: { enabled: true, ...stageOverrides.coder },
      security: { enabled: true, ...stageOverrides.security },
      tester: { enabled: true, ...stageOverrides.tester },
      reviewer: { enabled: true, ...stageOverrides.reviewer },
    },
  };
  configStore.set(`project:${projectId}:pipeline-config`, JSON.stringify(config));
}

describe("GitHubIssueMonitor", () => {
  let tmpDir: string;
  let mockCoo: ReturnType<typeof createMockCoo>;
  let mockIo: ReturnType<typeof createMockIo>;
  let monitor: GitHubIssueMonitor;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-issmon-test-"));
    resetDb();
    configStore.clear();
    mockFetchAssignedIssues.mockReset().mockResolvedValue([]);
    mockCreateIssueComment.mockReset().mockResolvedValue({
      id: 1,
      user: { login: "otterbot" },
      body: "",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      html_url: "",
    });
    mockFetchOpenIssues.mockReset().mockResolvedValue([]);
    mockCheckHasTriageAccess.mockReset().mockResolvedValue(true);
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    mockCoo = createMockCoo();
    mockIo = createMockIo();
    monitor = new GitHubIssueMonitor(mockCoo as any, mockIo as any);
    (monitor as any).pipelineManager = createMockPipelineManager();
  });

  afterEach(() => {
    monitor.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("watchProject / unwatchProject", () => {
    it("registers a project for watching", async () => {
      monitor.watchProject("proj-1", "owner/repo", "testuser");
      // Verify by triggering a poll — the project should be polled
      configStore.set("github:token", "ghp_test");
      mockFetchAssignedIssues.mockResolvedValue([]);
      // Access private poll method via prototype
      await (monitor as any).poll();
      expect(mockFetchAssignedIssues).toHaveBeenCalledWith(
        "owner/repo",
        "ghp_test",
        "testuser",
        undefined,
      );
    });

    it("unregisters a project from watching", async () => {
      monitor.watchProject("proj-1", "owner/repo", "testuser");
      monitor.unwatchProject("proj-1");

      configStore.set("github:token", "ghp_test");
      await (monitor as any).poll();

      // Should NOT have been called since we unwatched
      expect(mockFetchAssignedIssues).not.toHaveBeenCalled();
    });
  });

  describe("loadFromDb", () => {
    it("loads all projects with a githubRepo regardless of githubIssueMonitor flag", async () => {
      const db = getDb();
      configStore.set("github:username", "testuser");

      // Insert a project with issue monitoring enabled
      db.insert(schema.projects)
        .values({
          id: "proj-github",
          name: "GitHub Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Insert a project without issue monitoring — should still be watched
      db.insert(schema.projects)
        .values({
          id: "proj-no-monitor",
          name: "No Monitor",
          description: "test",
          status: "active",
          githubRepo: "owner/other",
          githubBranch: "main",
          githubIssueMonitor: false,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      monitor.loadFromDb();

      // Verify both projects are watched for assigned issues
      configStore.set("github:token", "ghp_test");
      await (monitor as any).poll();
      expect(mockFetchAssignedIssues).toHaveBeenCalledTimes(2);
      expect(mockFetchAssignedIssues).toHaveBeenCalledWith(
        "owner/repo",
        "ghp_test",
        "testuser",
        undefined,
      );
      expect(mockFetchAssignedIssues).toHaveBeenCalledWith(
        "owner/other",
        "ghp_test",
        "testuser",
        undefined,
      );
    });

    it("skips loading when github:username is not set", () => {
      const db = getDb();
      db.insert(schema.projects)
        .values({
          id: "proj-no-user",
          name: "No User",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // No github:username in configStore
      monitor.loadFromDb();

      configStore.set("github:token", "ghp_test");
      (monitor as any).poll();
      expect(mockFetchAssignedIssues).not.toHaveBeenCalled();
    });
  });

  describe("polling", () => {
    it("creates a kanban task for a new issue", async () => {
      const db = getDb();

      // Insert project
      db.insert(schema.projects)
        .values({
          id: "proj-poll",
          name: "Poll Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-poll", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 42,
          title: "Fix login bug",
          body: "The login page crashes",
          labels: [{ name: "bug" }],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/42",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Verify kanban task was created
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, "proj-poll"))
        .all();

      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("#42: Fix login bug");
      expect(tasks[0].description).toBe("The login page crashes");
      expect(tasks[0].column).toBe("backlog");
      expect((tasks[0].labels as string[])).toContain("github-issue-42");

      // Verify UI event was emitted
      expect(mockIo.emit).toHaveBeenCalledWith(
        "kanban:task-created",
        expect.objectContaining({ title: "#42: Fix login bug" }),
      );
    });

    it("does not create duplicate tasks for the same issue", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-dup",
          name: "Dup Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Pre-existing task with github-issue-10 label
      db.insert(schema.kanbanTasks)
        .values({
          id: "existing-task",
          projectId: "proj-dup",
          title: "#10: Existing issue",
          description: "",
          column: "backlog",
          position: 0,
          labels: ["github-issue-10"],
          blockedBy: [],
          retryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-dup", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 10,
          title: "Existing issue",
          body: "Already tracked",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/10",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Should still only have the original task
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, "proj-dup"))
        .all();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("existing-task");
    });

    it("updates last_polled_at after polling", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-ts",
          name: "Timestamp Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-ts", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      // setConfig should have been called with the last_polled_at key
      expect(configStore.has("project:proj-ts:github:last_polled_at")).toBe(true);
    });

    it("sends directive to TeamLead when issue is found", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-directive",
          name: "Directive Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Add a mock TeamLead
      mockCoo._teamLeads.set("proj-directive", { id: "tl-1" });

      monitor.watchProject("proj-directive", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 99,
          title: "New feature request",
          body: "Please add dark mode",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/99",
          created_at: "2026-02-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Verify directive was sent via bus
      expect(mockCoo.bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: "coo",
          toAgentId: "tl-1",
          content: expect.stringContaining("#99"),
        }),
      );
    });

    it("posts an acknowledgement comment on the GitHub issue", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-comment",
          name: "Comment Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-comment", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 112,
          title: "Comment on accepted issues",
          body: "Bot should comment when it accepts an issue",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/112",
          created_at: "2026-02-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      expect(mockCreateIssueComment).toHaveBeenCalledWith(
        "owner/repo",
        "ghp_test",
        112,
        expect.stringContaining("Looking into this issue"),
      );
    });

    it("does not post a comment for already-tracked issues", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-nocomment",
          name: "No Comment Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Pre-existing task
      db.insert(schema.kanbanTasks)
        .values({
          id: "existing-task-nc",
          projectId: "proj-nocomment",
          title: "#50: Already tracked",
          description: "",
          column: "backlog",
          position: 0,
          labels: ["github-issue-50"],
          blockedBy: [],
          retryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-nocomment", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 50,
          title: "Already tracked",
          body: "This is already in the backlog",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/50",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      expect(mockCreateIssueComment).not.toHaveBeenCalled();
    });

    it("continues processing when comment posting fails", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-commenterr",
          name: "Comment Error Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-commenterr", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockCreateIssueComment.mockRejectedValue(new Error("GitHub API error 403"));

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 77,
          title: "Comment will fail",
          body: "Test graceful error handling",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/77",
          created_at: "2026-02-01T00:00:00Z",
          updated_at: "2026-02-01T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Task should still be created despite comment failure
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, "proj-commenterr"))
        .all();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe("#77: Comment will fail");
    });

    it("skips polling when github:token is not set", async () => {
      monitor.watchProject("proj-notoken", "owner/repo", "testuser");
      // No github:token in configStore

      await (monitor as any).poll();

      expect(mockFetchAssignedIssues).not.toHaveBeenCalled();
    });

    it("promotes a triage task to backlog when an assigned issue matches", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-promo",
          name: "Promo Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Pre-existing triage task for issue #55
      db.insert(schema.kanbanTasks)
        .values({
          id: "triage-task-55",
          projectId: "proj-promo",
          title: "#55: Triage issue",
          description: "Triage: bug",
          column: "triage",
          position: 0,
          labels: ["github-issue-55"],
          blockedBy: [],
          retryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-promo", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 55,
          title: "Triage issue",
          body: "Issue body here",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/55",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Should have promoted the existing triage task to backlog, not created a new one
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, "proj-promo"))
        .all();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("triage-task-55");
      expect(tasks[0].column).toBe("backlog");

      // Should have emitted an update event
      expect(mockIo.emit).toHaveBeenCalledWith(
        "kanban:task-updated",
        expect.objectContaining({ id: "triage-task-55", column: "backlog" }),
      );
    });

    it("does not create duplicate when issue already in backlog", async () => {
      const db = getDb();

      db.insert(schema.projects)
        .values({
          id: "proj-nodup",
          name: "No Dup Project",
          description: "test",
          status: "active",
          githubRepo: "owner/repo",
          githubBranch: "main",
          githubIssueMonitor: true,
          rules: [],
          createdAt: new Date().toISOString(),
        })
        .run();

      // Pre-existing backlog task for issue #60
      db.insert(schema.kanbanTasks)
        .values({
          id: "backlog-task-60",
          projectId: "proj-nodup",
          title: "#60: Existing backlog issue",
          description: "",
          column: "backlog",
          position: 0,
          labels: ["github-issue-60"],
          blockedBy: [],
          retryCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      monitor.watchProject("proj-nodup", "owner/repo", "testuser");
      configStore.set("github:token", "ghp_test");

      mockFetchAssignedIssues.mockResolvedValue([
        {
          number: 60,
          title: "Existing backlog issue",
          body: "Already tracked",
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/60",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Should still only have one task
      const tasks = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, "proj-nodup"))
        .all();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe("backlog-task-60");
    });
  });

  describe("start / stop", () => {
    it("starts and stops the polling interval", () => {
      vi.useFakeTimers();

      monitor.start(10_000);

      // Verify interval is set
      expect((monitor as any).intervalId).not.toBeNull();

      monitor.stop();
      expect((monitor as any).intervalId).toBeNull();

      vi.useRealTimers();
    });

    it("does not start a second interval if already started", () => {
      vi.useFakeTimers();

      monitor.start(10_000);
      const firstId = (monitor as any).intervalId;
      monitor.start(10_000);
      const secondId = (monitor as any).intervalId;

      expect(firstId).toBe(secondId);

    monitor.stop();
    vi.useRealTimers();
  });
});

describe("triage collaborator check", () => {
  beforeEach(() => {
    configStore.set("github:username", "otterbot");
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "otterbot");
    mockCheckHasTriageAccess.mockResolvedValue(true);
  });

  afterEach(() => {
    configStore.delete("github:username");
  });

  it("skips triage when bot is not a collaborator", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-triage-no-collab",
        name: "Triage No Collab",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-triage-no-collab", "owner/repo", "testuser");
    configStore.set("pipeline:proj-triage-no-collab:enabled", "true");
    configStore.set("pipeline:proj-triage-no-collab:stages.triage.enabled", "true");
    mockCheckHasTriageAccess.mockResolvedValue(false);

    await (monitor as any).poll();

    expect(mockFetchOpenIssues).not.toHaveBeenCalled();
  });

  it("performs triage when bot is a collaborator", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-triage-collab",
        name: "Triage Collab",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-triage-collab", "owner/repo", "testuser");
    setPipelineConfig("proj-triage-collab", { triage: { enabled: true } });

    mockFetchOpenIssues.mockResolvedValue([
      {
        number: 5,
        title: "Issue needing triage",
        body: "Bug report",
        labels: [{ name: "bug" }],
        state: "open",
        html_url: "https://github.com/owner/repo/issues/5",
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-02-02T00:00:00Z",
      },
    ]);

    await (monitor as any).poll();

    expect(mockFetchOpenIssues).toHaveBeenCalledWith("owner/repo", "ghp_test", undefined);
    expect(mockCheckHasTriageAccess).toHaveBeenCalledWith("owner/repo", "ghp_test");
  });

  it("caches collaborator status for the same repo", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-cached",
        name: "Cached",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-cached", "owner/repo", "testuser");
    setPipelineConfig("proj-cached", { triage: { enabled: true } });

    await (monitor as any).poll();
    await (monitor as any).poll();

    expect(mockCheckHasTriageAccess).toHaveBeenCalledTimes(1);
  });

  it("refreshes cache after TTL expires", async () => {
    vi.useFakeTimers();

    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-cache-refresh",
        name: "Cache Refresh",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-cache-refresh", "owner/repo", "testuser");
    setPipelineConfig("proj-cache-refresh", { triage: { enabled: true } });

    await (monitor as any).poll();

    vi.advanceTimersByTime(600_001);

    await (monitor as any).poll();

    expect(mockCheckHasTriageAccess).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("handles collaborator check failure gracefully (fail closed)", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-fail-open",
        name: "Fail Open",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-fail-open", "owner/repo", "testuser");
    setPipelineConfig("proj-fail-open", { triage: { enabled: true } });
    mockCheckHasTriageAccess.mockRejectedValue(new Error("API error"));

    mockFetchOpenIssues.mockResolvedValue([]);

    await (monitor as any).poll();

    expect(mockFetchOpenIssues).not.toHaveBeenCalled();
  });

  it("skips triage when github:username is not set", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-no-username",
        name: "No Username",
        description: "test",
        status: "active",
        githubRepo: "owner/repo",
        githubBranch: "main",
        githubIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    monitor.watchProject("proj-no-username", "owner/repo", "testuser");
    configStore.set("pipeline:proj-no-username:enabled", "true");
    configStore.set("pipeline:proj-no-username:stages.triage.enabled", "true");
    configStore.delete("github:username");
    configStore.set("pipeline:proj-no-username:stages.triage.enabled", "true");

    await (monitor as any).poll();

    expect(mockCheckHasTriageAccess).not.toHaveBeenCalled();
    expect(mockFetchOpenIssues).not.toHaveBeenCalled();
  });
});
});
