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
vi.mock("../github-service.js", () => ({
  fetchPullRequest: (...args: any[]) => mockFetchPullRequest(...args),
  fetchPullRequestReviews: (...args: any[]) => mockFetchPullRequestReviews(...args),
  fetchPullRequestReviewComments: (...args: any[]) => mockFetchPullRequestReviewComments(...args),
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

import { GitHubPRMonitor, MAX_REVIEW_CYCLES } from "../pr-monitor.js";

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
    it("moves task to backlog, increments retryCount, and clears PR fields", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-2",
        projectId: "proj-1",
        title: "#10: Feature",
        column: "in_review",
        prNumber: 10,
        prBranch: "feat/feature-10",
        retryCount: 1,
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
      expect(task?.retryCount).toBe(2);
      expect(task?.prNumber).toBeNull();
      expect(task?.prBranch).toBeNull();
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

  describe("review cycle tracking", () => {
    it("increments pipelineAttempt on each changes-requested review", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-rc-1",
        projectId: "proj-1",
        title: "#20: Review cycle",
        column: "in_review",
        prNumber: 20,
        prBranch: "feat/rc",
        pipelineAttempt: 0,
      });

      mockCoo._teamLeads.set("proj-1", { id: "tl-1" });
      configStore.set("github:token", "ghp_test");

      mockFetchPullRequest.mockResolvedValue({
        number: 20,
        state: "open",
        merged: false,
        head: { ref: "feat/rc", sha: "abc" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 501,
          user: { login: "reviewer" },
          body: "Fix please",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-20T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/20#pullrequestreview-501",
        },
      ]);
      mockFetchPullRequestReviewComments.mockResolvedValue([]);

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-rc-1"))
        .get();

      expect(task?.pipelineAttempt).toBe(1);
      expect(task?.column).toBe("in_progress");
    });

    it("marks task as failed when max review cycles exceeded", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-rc-2",
        projectId: "proj-1",
        title: "#21: Exhaust retries",
        column: "in_review",
        prNumber: 21,
        prBranch: "feat/exhaust",
        pipelineAttempt: MAX_REVIEW_CYCLES, // already at max
      });

      mockCoo._teamLeads.set("proj-1", { id: "tl-1" });
      configStore.set("github:token", "ghp_test");

      mockFetchPullRequest.mockResolvedValue({
        number: 21,
        state: "open",
        merged: false,
        head: { ref: "feat/exhaust", sha: "def" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 601,
          user: { login: "reviewer" },
          body: "Still broken",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-21T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/21#pullrequestreview-601",
        },
      ]);

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-rc-2"))
        .get();

      expect(task?.column).toBe("done");
      expect(task?.completionReport).toContain("FAILED");
      expect(task?.completionReport).toContain("exceeded maximum review cycles");
      expect(task?.pipelineAttempt).toBe(MAX_REVIEW_CYCLES + 1);

      // Should NOT send a directive (task failed, no retry)
      expect(mockCoo.bus.send).not.toHaveBeenCalled();
      // Should NOT fetch review comments (bailed early)
      expect(mockFetchPullRequestReviewComments).not.toHaveBeenCalled();
    });

    it("allows retry up to MAX_REVIEW_CYCLES before failing", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-rc-3",
        projectId: "proj-1",
        title: "#22: Last chance",
        column: "in_review",
        prNumber: 22,
        prBranch: "feat/last-chance",
        pipelineAttempt: MAX_REVIEW_CYCLES - 1, // one attempt left
      });

      mockCoo._teamLeads.set("proj-1", { id: "tl-1" });
      configStore.set("github:token", "ghp_test");

      mockFetchPullRequest.mockResolvedValue({
        number: 22,
        state: "open",
        merged: false,
        head: { ref: "feat/last-chance", sha: "ghi" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 701,
          user: { login: "reviewer" },
          body: "One more fix",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-22T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/22#pullrequestreview-701",
        },
      ]);
      mockFetchPullRequestReviewComments.mockResolvedValue([]);

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-rc-3"))
        .get();

      // Should still retry (pipelineAttempt = MAX_REVIEW_CYCLES, which is <= MAX)
      expect(task?.pipelineAttempt).toBe(MAX_REVIEW_CYCLES);
      expect(task?.column).toBe("in_progress");
      expect(mockCoo.bus.send).toHaveBeenCalledTimes(1);
    });
  });

  describe("pipeline-managed review cycles", () => {
    it("increments pipelineAttempt and routes through pipeline", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-pm-1",
        projectId: "proj-1",
        title: "#30: Pipeline review",
        column: "in_review",
        prNumber: 30,
        prBranch: "feat/pipeline-review",
        pipelineAttempt: 0,
      });

      configStore.set("github:token", "ghp_test");

      const mockPipelineManager = {
        isEnabled: vi.fn().mockReturnValue(true),
        handleReviewFeedback: vi.fn().mockResolvedValue(undefined),
      };
      monitor.setPipelineManager(mockPipelineManager as any);

      mockFetchPullRequest.mockResolvedValue({
        number: 30,
        state: "open",
        merged: false,
        head: { ref: "feat/pipeline-review", sha: "xyz" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 801,
          user: { login: "reviewer" },
          body: "Needs changes",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-22T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/30#pullrequestreview-801",
        },
      ]);
      mockFetchPullRequestReviewComments.mockResolvedValue([]);

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-pm-1"))
        .get();

      expect(task?.pipelineAttempt).toBe(1);
      expect(task?.column).toBe("in_progress");
      expect(mockPipelineManager.handleReviewFeedback).toHaveBeenCalledWith(
        "task-pm-1",
        expect.stringContaining("Needs changes"),
        "feat/pipeline-review",
        30,
      );
    });

    it("fails pipeline-managed task when max review cycles exceeded", async () => {
      const db = getDb();
      insertProject(db, "proj-1", "owner/repo");
      insertTask(db, {
        id: "task-pm-2",
        projectId: "proj-1",
        title: "#31: Pipeline exhaust",
        column: "in_review",
        prNumber: 31,
        prBranch: "feat/pipeline-exhaust",
        pipelineAttempt: MAX_REVIEW_CYCLES,
      });

      configStore.set("github:token", "ghp_test");

      const mockPipelineManager = {
        isEnabled: vi.fn().mockReturnValue(true),
        handleReviewFeedback: vi.fn().mockResolvedValue(undefined),
      };
      monitor.setPipelineManager(mockPipelineManager as any);

      mockFetchPullRequest.mockResolvedValue({
        number: 31,
        state: "open",
        merged: false,
        head: { ref: "feat/pipeline-exhaust", sha: "xyz" },
        base: { ref: "main" },
      });
      mockFetchPullRequestReviews.mockResolvedValue([
        {
          id: 901,
          user: { login: "reviewer" },
          body: "Still broken",
          state: "CHANGES_REQUESTED",
          submitted_at: "2026-02-22T00:00:00Z",
          html_url: "https://github.com/owner/repo/pull/31#pullrequestreview-901",
        },
      ]);

      await (monitor as any).poll();

      const task = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, "task-pm-2"))
        .get();

      expect(task?.column).toBe("done");
      expect(task?.completionReport).toContain("FAILED");
      // Pipeline should NOT be called
      expect(mockPipelineManager.handleReviewFeedback).not.toHaveBeenCalled();
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
});
