import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const configStore = new Map<string, string>();
vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
}));

vi.mock("./account-resolver.js", () => ({
  resolveGiteaToken: vi.fn((_projectId?: string) => configStore.get("gitea:token")),
  resolveGiteaInstanceUrl: vi.fn((_projectId?: string) => configStore.get("gitea:instance_url")),
}));

const mockFetchPullRequest = vi.fn();
const mockFetchPullRequests = vi.fn().mockResolvedValue([]);
const mockFetchPullRequestReviews = vi.fn().mockResolvedValue([]);
const mockFetchPullRequestReviewComments = vi.fn().mockResolvedValue([]);
const mockFetchCommitStatusesForRef = vi.fn().mockResolvedValue([]);
const mockAggregateCommitStatus = vi.fn().mockReturnValue(null);
vi.mock("./gitea-service.js", () => ({
  fetchPullRequest: (...args: unknown[]) => mockFetchPullRequest(...args),
  fetchPullRequests: (...args: unknown[]) => mockFetchPullRequests(...args),
  fetchPullRequestReviews: (...args: unknown[]) => mockFetchPullRequestReviews(...args),
  fetchPullRequestReviewComments: (...args: unknown[]) => mockFetchPullRequestReviewComments(...args),
  fetchCommitStatusesForRef: (...args: unknown[]) => mockFetchCommitStatusesForRef(...args),
  aggregateCommitStatus: (...args: unknown[]) => mockAggregateCommitStatus(...args),
}));

import { GiteaPRMonitor } from "./pr-monitor.js";

function createMockCoo() {
  const teamLeads = new Map<string, { id: string; notifyTaskDone?: ReturnType<typeof vi.fn> }>();
  return {
    getTeamLeads: vi.fn(() => teamLeads),
    bus: { send: vi.fn() },
    _teamLeads: teamLeads,
  };
}

function createMockIo() {
  return { emit: vi.fn() };
}

function insertProject(id: string, repo = "owner/repo") {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id,
      name: "Test project",
      description: "",
      status: "active",
      giteaRepo: repo,
      giteaBranch: "main",
      rules: [],
      createdAt: new Date().toISOString(),
    })
    .run();
}

function insertReviewTask(id: string, projectId: string, prNumber: number, prBranch = "feat/test") {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.kanbanTasks)
    .values({
      id,
      projectId,
      title: "Review task",
      description: "",
      column: "in_review",
      position: 0,
      labels: [],
      blockedBy: [],
      retryCount: 0,
      spawnCount: 0,
      prNumber,
      prBranch,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("GiteaPRMonitor", () => {
  let tmpDir: string;
  let monitor: GiteaPRMonitor;
  let mockCoo: ReturnType<typeof createMockCoo>;
  let mockIo: ReturnType<typeof createMockIo>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gitea-pr-monitor-test-"));
    resetDb();
    configStore.clear();
    mockFetchPullRequest.mockReset();
    mockFetchPullRequests.mockReset().mockResolvedValue([]);
    mockFetchPullRequestReviews.mockReset().mockResolvedValue([]);
    mockFetchPullRequestReviewComments.mockReset().mockResolvedValue([]);
    mockFetchCommitStatusesForRef.mockReset().mockResolvedValue([]);
    mockAggregateCommitStatus.mockReset().mockReturnValue(null);
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    configStore.set("gitea:token", "pat");
    configStore.set("gitea:instance_url", "https://git.example.com");

    mockCoo = createMockCoo();
    mockIo = createMockIo();
    monitor = new GiteaPRMonitor(mockCoo as any, mockIo as any);
  });

  afterEach(() => {
    monitor.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("moves task to done when PR is merged", async () => {
    insertProject("proj-1");
    insertReviewTask("task-1", "proj-1", 42, "feat/done");

    mockFetchPullRequest.mockResolvedValue({
      number: 42,
      state: "closed",
      merged: true,
      head: { ref: "feat/done", sha: "abc123" },
      base: { ref: "main" },
    });

    await (monitor as any).poll();

    const task = getDb()
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

  it("moves task to backlog when PR is closed without merge", async () => {
    insertProject("proj-2");
    insertReviewTask("task-2", "proj-2", 7, "feat/backlog");

    mockFetchPullRequest.mockResolvedValue({
      number: 7,
      state: "closed",
      merged: false,
      head: { ref: "feat/backlog", sha: "def456" },
      base: { ref: "main" },
    });

    await (monitor as any).poll();

    const task = getDb()
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, "task-2"))
      .get();

    expect(task?.column).toBe("backlog");
    expect(task?.assigneeAgentId).toBeNull();
  });

  it("treats REQUEST_CHANGES as changes-requested review state", async () => {
    insertProject("proj-3");
    insertReviewTask("task-3", "proj-3", 13, "feat/rework");
    mockCoo._teamLeads.set("proj-3", { id: "tl-1" });

    mockFetchPullRequest.mockResolvedValue({
      number: 13,
      state: "open",
      merged: false,
      head: { ref: "feat/rework", sha: "ghi789" },
      base: { ref: "main" },
    });

    mockFetchPullRequestReviews.mockResolvedValue([
      {
        id: 300,
        user: { login: "reviewer" },
        body: "Please adjust the query handling",
        state: "REQUEST_CHANGES",
        submitted_at: "2026-03-09T00:00:00Z",
        html_url: "",
      },
    ]);

    mockFetchPullRequestReviewComments.mockResolvedValue([
      {
        id: 301,
        user: { login: "reviewer" },
        body: "Needs a null check",
        path: "src/handler.ts",
        line: 27,
        diff_hunk: "@@ -20,3 +20,5 @@",
        created_at: "2026-03-09T00:00:00Z",
      },
    ]);

    await (monitor as any).poll();

    const task = getDb()
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.id, "task-3"))
      .get();

    expect(task?.column).toBe("in_progress");
    expect(task?.description).toContain("PR REVIEW CYCLE");
    expect(task?.description).toContain("REQUEST_CHANGES");
    expect((mockCoo.bus.send as any).mock.calls[0][0].content).toContain("Do NOT create any new tasks");
  });
});
