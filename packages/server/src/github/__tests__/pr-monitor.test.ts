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
const mockFetchPullRequest = vi.fn();
const mockFetchPullRequestReviews = vi.fn().mockResolvedValue([]);
const mockFetchPullRequestReviewComments = vi.fn().mockResolvedValue([]);
const mockFetchCheckRunsForRef = vi.fn();
const mockAggregateCheckRunStatus = vi.fn();

vi.mock("../github-service.js", () => ({
  fetchPullRequest: (...args: any[]) => mockFetchPullRequest(...args),
  fetchPullRequestReviews: (...args: any[]) => mockFetchPullRequestReviews(...args),
  fetchPullRequestReviewComments: (...args: any[]) => mockFetchPullRequestReviewComments(...args),
  fetchCheckRunsForRef: (...args: any[]) => mockFetchCheckRunsForRef(...args),
  aggregateCheckRunStatus: (...args: any[]) => mockAggregateCheckRunStatus(...args),
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

import { GitHubPRMonitor } from "../pr-monitor.js";

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

function insertProject(db: ReturnType<typeof getDb>, id: string, repo: string) {
  db.insert(schema.projects)
    .values({
      id,
      name: "Test Project",
      description: "test",
      status: "active",
      githubRepo: repo,
      githubBranch: "main",
      githubIssueMonitor: true,
      rules: [],
      createdAt: new Date().toISOString(),
    })
    .run();
}

function insertTask(
  db: ReturnType<typeof getDb>,
  overrides: Partial<typeof schema.kanbanTasks.$inferInsert> & { id: string; projectId: string },
) {
  const now = new Date().toISOString();
  db.insert(schema.kanbanTasks)
    .values({
      title: "Test task",
      description: "",
      column: "in_review",
      position: 0,
      labels: [],
      blockedBy: [],
      retryCount: 0,
      spawnCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
}

describe("GitHubPRMonitor", () => {
  let tmpDir: string;
  let mockCoo: ReturnType<typeof createMockCoo>;
  let mockIo: ReturnType<typeof createMockIo>;
  let monitor: GitHubPRMonitor;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-prmon-test-"));
    resetDb();
    configStore.clear();
    mockFetchPullRequest.mockReset();
    mockFetchPullRequestReviews.mockReset().mockResolvedValue([]);
    mockFetchPullRequestReviewComments.mockReset().mockResolvedValue([]);
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    mockCoo = createMockCoo();
    mockIo = createMockIo();
    monitor = new GitHubPRMonitor(mockCoo as any, mockIo as any);
  });

  afterEach(() => {
    monitor.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("merged PR", () => {
    it("moves task to done when PR is merged", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-1",
        projectId: "proj-1",
        title: "#42: Fix bug",
        column: "in_review",
        prNumber: 42,
        prBranch: "feat/fix-42",
      });

      configStore.set("github:token", "ghp_test");
      mockFetchPullRequest.mockResolvedValue({
        number: 42,
        state: "closed",
        merged: true,
        head: { ref: "feat/fix-42", sha: "abc123" },
        base: { ref: "main" },
      });

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-1"))
        .get();

      expect(task?.column).toBe("done");
      expect(task?.completionReport).toContain("PR #42 merged");
      expect(mockIo.emit).toHaveBeenCalledWith(
        "kanban:task-updated",
        expect.objectContaining({ id: "task-1", column: "done" }),
      );
    });
  });

  describe("closed PR (not merged)", () => {
    it("moves task to backlog when PR is closed without merge", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-2",
        projectId: "proj-1",
        title: "#10: Feature",
        column: "in_review",
        prNumber: 10,
        prBranch: "feat/feature-10",
      });

      configStore.set("github:token", "ghp_test");
      mockFetchPullRequest.mockResolvedValue({
        number: 10,
        state: "closed",
        merged: false,
        head: { ref: "feat/feature-10", sha: "def456" },
        base: { ref: "main" },
      });

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-2"))
        .get();

      expect(task?.column).toBe("backlog");
      expect(task?.assigneeAgentId).toBeNull();
    });
  });

  describe("changes requested", () => {
    it("sends directive to TeamLead when changes are requested", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-3",
        projectId: "proj-1",
        title: "#5: Fix tests",
        column: "in_review",
        prNumber: 5,
        prBranch: "feat/fix-tests",
      });

      mockCoo._teamLeads.set("proj-1", { id: "tl-1" });
      configStore.set("github:token", "ghp_test");

      mockFetchPullRequest.mockResolvedValue({
        number: 5,
        state: "open",
        merged: false,
        head: { ref: "feat/fix-tests", sha: "ghi789" },
        base: { ref: "main" },
      });

      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 101,
          user: { login: "reviewer" },
          body: "Please fix the test assertions",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-20T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/5#pullrequestreview-101",
        },
      ]);

      mockFetchPullRequestReviewComments.mockResolvedValue([
        {
          id: 201,
          user: { login: "reviewer" },
          body: "This assertion is wrong",
          path: "src/test.ts",
          line: 42,
          diff_hunk: "@@ -40,3 +40,3 @@\n expect(result).toBe(true)",
          created_at: "2026-02-20T00:00:00Z",
        },
      ]);

      await (monitor as any).poll();

      // Task should move to in_progress with updated description
      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-3"))
        .get();
      expect(task?.column).toBe("in_progress");
      expect(task?.description).toContain("PR REVIEW CYCLE");
      expect(task?.description).toContain("Please fix the test assertions");

      // Directive should be sent
      expect(mockCoo.bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: "coo",
          toAgentId: "tl-1",
          content: expect.stringContaining("Do NOT create any new tasks"),
        }),
      );

      // Content should include branch name and task ID
      const sentContent = (mockCoo.bus.send.mock.calls[0] as any[])[0].content as string;
      expect(sentContent).toContain("feat/fix-tests");
      expect(sentContent).toContain("PR #5");
      expect(sentContent).toContain("task-3");
    });
  });

  describe("deduplication", () => {
    it("does not re-trigger on the same review", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-4",
        projectId: "proj-1",
        title: "#7: Dedup test",
        column: "in_review",
        prNumber: 7,
        prBranch: "feat/dedup",
      });

      mockCoo._teamLeads.set("proj-1", { id: "tl-1" });
      configStore.set("github:token", "ghp_test");

      const review = {
        id: 301,
        user: { login: "reviewer" },
        body: "Fix this",
        state: "CHANGES_REQUESTED" as const,
        submitted_at: "2026-02-20T00:00:00Z",
        html_url: "https://github.com/owner/repo/pull/7#pullrequestreview-301",
      };

      mockFetchPullRequest.mockResolvedValue({
        number: 7,
        state: "open",
        merged: false,
        head: { ref: "feat/dedup", sha: "jkl012" },
        base: { ref: "main" },
      });

      mockFetchPullRequestReviews.mockResolvedValue([review]);
      mockFetchPullRequestReviewComments.mockResolvedValue([]);

      // First poll triggers the directive
      await (monitor as any).poll();
      expect(mockCoo.bus.send).toHaveBeenCalledTimes(1);

      // Reset the task back to in_review (simulating the cycle completing)
      db.update(schema.kanbanTasks)
        .set({ column: "in_review" })
        .where(eq(schema.kanbanTasks.id, "task-4"))
        .run();

      mockCoo.bus.send.mockClear();
      mockFetchPullRequest.mockClear();
      mockFetchPullRequestReviews.mockClear();

      // Second poll with same review should NOT trigger
      mockFetchPullRequest.mockResolvedValue({
        number: 7,
        state: "open",
        merged: false,
        head: { ref: "feat/dedup", sha: "jkl012" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([review]);
      mockFetchPullRequestReviewComments.mockResolvedValue([]);

      await (monitor as any).poll();
      expect(mockCoo.bus.send).not.toHaveBeenCalled();
    });
  });

  describe("tasks without prNumber", () => {
    it("skips tasks without prNumber", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-5",
        projectId: "proj-1",
        title: "No PR task",
        column: "in_review",
        prNumber: null,
      });

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      // fetchPullRequest should not have been called
      expect(mockFetchPullRequest).not.toHaveBeenCalled();
    });
  });

  describe("skips when no token", () => {
    it("skips polling when github:token is not set", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-6",
        projectId: "proj-1",
        title: "PR task",
        column: "in_review",
        prNumber: 99,
      });

      // No github:token set
      await (monitor as any).poll();
      expect(mockFetchPullRequest).not.toHaveBeenCalled();
    });
  });

  describe("start / stop", () => {
    it("starts and stops the polling interval", () => {
      vi.useFakeTimers();

      monitor.start(10_000);
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

  describe("CI failure detection", () => {
    beforeEach(() => {
      mockFetchCheckRunsForRef.mockReset();
      mockAggregateCheckRunStatus.mockReset();
    });

    it("detects CI failure and routes task back to in_progress", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-ci-fail",
        projectId: "proj-1",
        title: "#50: CI failure",
        column: "in_review",
        prNumber: 50,
        prBranch: "feat/ci-fail",
      });

      mockFetchPullRequest.mockResolvedValue({
        number: 50,
        state: "open",
        merged: false,
        head: { ref: "feat/ci-fail", sha: "abc123def456" },
        base: { ref: "main" },
      });

      mockFetchCheckRunsForRef.mockResolvedValue([
        {
          id: 101,
          name: "Test Suite",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/owner/repo/runs/101",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 102,
          name: "Lint",
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/owner/repo/runs/102",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:02:00Z",
        },
      ]);

      mockAggregateCheckRunStatus.mockReturnValue("failure");

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-ci-fail"))
        .get();

      expect(task?.column).toBe("in_progress");
      expect(task?.assigneeAgentId).toBeNull();

      expect(mockIo.emit).toHaveBeenCalledWith(
        "kanban:task-updated",
        expect.objectContaining({ id: "task-ci-fail", column: "in_progress" }),
      );
    });

    it("does not act on pending CI status", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-ci-pending",
        projectId: "proj-1",
        title: "#51: CI pending",
        column: "in_review",
        prNumber: 51,
        prBranch: "feat/ci-pending",
      });

      mockFetchPullRequest.mockResolvedValue({
        number: 51,
        state: "open",
        merged: false,
        head: { ref: "feat/ci-pending", sha: "def456abc123" },
        base: { ref: "main" },
      });

      mockFetchCheckRunsForRef.mockResolvedValue([
        {
          id: 201,
          name: "Test Suite",
          status: "in_progress" as const,
          conclusion: null,
          html_url: "https://github.com/owner/repo/runs/201",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: null,
        },
      ]);

      mockAggregateCheckRunStatus.mockReturnValue("pending");

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-ci-pending"))
        .get();

      expect(task?.column).toBe("in_review");
    });

    it("does not act on CI success", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-ci-success",
        projectId: "proj-1",
        title: "#52: CI success",
        column: "in_review",
        prNumber: 52,
        prBranch: "feat/ci-success",
      });

      mockFetchPullRequest.mockResolvedValue({
        number: 52,
        state: "open",
        merged: false,
        head: { ref: "feat/ci-success", sha: "ghi789jkl012" },
        base: { ref: "main" },
      });

      mockFetchCheckRunsForRef.mockResolvedValue([
        {
          id: 301,
          name: "Test Suite",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "https://github.com/owner/repo/runs/301",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ]);

      mockAggregateCheckRunStatus.mockReturnValue("success");

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-ci-success"))
        .get();

      expect(task?.column).toBe("in_review");
    });

    it("does not re-trigger on same SHA after CI failure", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-ci-repeat",
        projectId: "proj-1",
        title: "#53: CI repeat",
        column: "in_review",
        prNumber: 53,
        prBranch: "feat/ci-repeat",
      });

      mockFetchPullRequest.mockResolvedValue({
        number: 53,
        state: "open",
        merged: false,
        head: { ref: "feat/ci-repeat", sha: "repeat123sha" },
        base: { ref: "main" },
      });

      mockFetchCheckRunsForRef.mockResolvedValue([
        {
          id: 401,
          name: "Test Suite",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/owner/repo/runs/401",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ]);

      mockAggregateCheckRunStatus.mockReturnValue("failure");

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      const task1 = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-ci-repeat"))
        .get();

      expect(task1?.column).toBe("in_progress");

      db.update(schema.kanbanTasks)
        .set({ column: "in_review" })
        .where(eq(schema.kanbanTasks.id, "task-ci-repeat"))
        .run();

      const sameSha = "repeat123sha";
      mockFetchPullRequest.mockResolvedValue({
        number: 53,
        state: "open",
        merged: false,
        head: { ref: "feat/ci-repeat", sha: sameSha },
        base: { ref: "main" },
      });

      await (monitor as any).poll();

      const task2 = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-ci-repeat"))
        .get();

      // Task should remain in_review because the same SHA was already processed
      expect(task2?.column).toBe("in_review");
    });

    it("handles missing check runs gracefully", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-no-checks",
        projectId: "proj-1",
        title: "#54: No checks",
        column: "in_review",
        prNumber: 54,
        prBranch: "feat/no-checks",
      });

      mockFetchPullRequest.mockResolvedValue({
        number: 54,
        state: "open",
        merged: false,
        head: { ref: "feat/no-checks", sha: "nochecks123" },
        base: { ref: "main" },
      });

      mockFetchCheckRunsForRef.mockResolvedValue([]);

      mockAggregateCheckRunStatus.mockReturnValue(null);

      configStore.set("github:token", "ghp_test");

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-no-checks"))
        .get();

      expect(task?.column).toBe("in_review");
    });
  });
});
