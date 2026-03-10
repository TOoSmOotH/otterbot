import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

// --- Mocks ---

const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
}));

const mockFetchPullRequest = vi.fn();
const mockMergePullRequest = vi.fn();
const mockCreateIssueComment = vi.fn();
vi.mock("../../github/github-service.js", () => ({
  fetchPullRequest: (...args: unknown[]) => mockFetchPullRequest(...args),
  mergePullRequest: (...args: unknown[]) => mockMergePullRequest(...args),
  createIssueComment: (...args: unknown[]) => mockCreateIssueComment(...args),
  resolveProjectBranch: vi.fn(() => "main"),
  gitEnvWithPAT: vi.fn(() => ({})),
  gitCredentialArgs: vi.fn(() => []),
}));

const mockRebaseBranch = vi.fn();
const mockForcePushBranch = vi.fn();
vi.mock("../../utils/git.js", () => ({
  rebaseBranch: (...args: unknown[]) => mockRebaseBranch(...args),
  forcePushBranch: (...args: unknown[]) => mockForcePushBranch(...args),
}));

vi.mock("../../utils/github-comments.js", () => ({
  formatBotComment: vi.fn((...args: string[]) => args.join(" | ")),
}));

import { MergeQueue } from "../merge-queue.js";

// --- Factory helpers ---

const PROJECT_ID = "test-project";

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockWorkspace() {
  return {
    repoPath: vi.fn((projectId: string) => `/workspace/${projectId}/repo`),
  } as any;
}

function createMockCoo(teamLeadOverrides?: Record<string, { notifyTaskDone: ReturnType<typeof vi.fn> }>) {
  const teamLeads = new Map<string, { notifyTaskDone: ReturnType<typeof vi.fn> }>();
  if (teamLeadOverrides) {
    for (const [key, val] of Object.entries(teamLeadOverrides)) {
      teamLeads.set(key, val);
    }
  }
  return {
    getTeamLeads: vi.fn(() => teamLeads),
    _teamLeads: teamLeads,
  } as any;
}

function createMockPipelineManager(overrides?: {
  isEnabled?: boolean;
  startReReview?: (...args: unknown[]) => Promise<void>;
}) {
  return {
    isEnabled: vi.fn(() => overrides?.isEnabled ?? false),
    startReReview: overrides?.startReReview ?? vi.fn().mockResolvedValue(undefined),
  } as any;
}

function insertTask(overrides: Partial<{
  id: string;
  title: string;
  column: "triage" | "backlog" | "in_progress" | "in_review" | "done";
  description: string;
  assigneeAgentId: string | null;
  prNumber: number | null;
  prBranch: string | null;
  completionReport: string | null;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const task = {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT_ID,
    title: overrides.title ?? "Test task",
    description: overrides.description ?? "",
    column: overrides.column ?? ("in_review" as const),
    position: 0,
    assigneeAgentId: overrides.assigneeAgentId ?? null,
    createdBy: "test",
    labels: [],
    blockedBy: [],
    retryCount: 0,
    spawnCount: 0,
    completionReport: overrides.completionReport ?? null,
    prNumber: "prNumber" in overrides ? overrides.prNumber! : 42,
    prBranch: "prBranch" in overrides ? overrides.prBranch! : "feat/test-branch",
    pipelineStage: null,
    pipelineStages: [],
    stageReports: {},
    lastKickbackSource: null,
    spawnRetryCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.kanbanTasks).values(task).run();
  return task;
}

function insertProject(overrides: Partial<{
  id: string;
  githubRepo: string;
  githubBranch: string;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const project = {
    id: overrides.id ?? PROJECT_ID,
    name: "Test Project",
    description: "",
    status: "active" as const,
    githubRepo: overrides.githubRepo ?? "owner/repo",
    githubBranch: overrides.githubBranch ?? "main",
    githubIssueMonitor: false,
    rules: [],
    createdAt: now,
  };
  db.insert(schema.projects).values(project).run();
  return project;
}

function insertMergeQueueEntry(overrides: Partial<{
  id: string;
  taskId: string;
  projectId: string;
  prNumber: number;
  prBranch: string;
  baseBranch: string;
  status: "queued" | "rebasing" | "re_review" | "merging" | "merged" | "conflict" | "failed";
  position: number;
  rebaseAttempts: number;
  lastError: string | null;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const entry = {
    id: overrides.id ?? nanoid(),
    taskId: overrides.taskId ?? "task-1",
    projectId: overrides.projectId ?? PROJECT_ID,
    prNumber: overrides.prNumber ?? 42,
    prBranch: overrides.prBranch ?? "feat/test",
    baseBranch: overrides.baseBranch ?? "main",
    status: overrides.status ?? "queued",
    position: overrides.position ?? 1,
    rebaseAttempts: overrides.rebaseAttempts ?? 0,
    lastError: overrides.lastError ?? null,
    approvedAt: now,
    mergedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.mergeQueue).values(entry).run();
  return entry;
}

function getTask(taskId: string) {
  return getDb()
    .select()
    .from(schema.kanbanTasks)
    .where(eq(schema.kanbanTasks.id, taskId))
    .get();
}

function getMergeQueueEntry(entryId: string) {
  return getDb()
    .select()
    .from(schema.mergeQueue)
    .where(eq(schema.mergeQueue.id, entryId))
    .get();
}

function getMergeQueueEntryByTask(taskId: string) {
  return getDb()
    .select()
    .from(schema.mergeQueue)
    .where(eq(schema.mergeQueue.taskId, taskId))
    .get();
}

// --- Tests ---

describe("MergeQueue", () => {
  let tmpDir: string;
  let io: ReturnType<typeof createMockIO>;
  let workspace: ReturnType<typeof createMockWorkspace>;
  let mq: MergeQueue;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-mq-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    io = createMockIO();
    workspace = createMockWorkspace();
    mq = new MergeQueue(io, workspace);

    mockFetchPullRequest.mockReset();
    mockMergePullRequest.mockReset();
    mockCreateIssueComment.mockReset();
    mockRebaseBranch.mockReset();
    mockForcePushBranch.mockReset();
  });

  afterEach(() => {
    mq.stop();
    resetDb();
    configStore.clear();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── approveForMerge ───────────────────────────────────────

  describe("approveForMerge", () => {
    it("enqueues task with correct status/position/branches", () => {
      const task = insertTask({ id: "task-approve-1", prNumber: 10, prBranch: "feat/foo" });
      insertProject();
      configStore.set("project:test-project:github:branch", "main");

      const entry = mq.approveForMerge(task.id);

      expect(entry).not.toBeNull();
      expect(entry!.taskId).toBe(task.id);
      expect(entry!.prNumber).toBe(10);
      expect(entry!.prBranch).toBe("feat/foo");
      expect(entry!.baseBranch).toBe("main");
      expect(entry!.status).toBe("queued");
      expect(entry!.position).toBeGreaterThan(0);
    });

    it("returns null when task has no prNumber", () => {
      const task = insertTask({ id: "task-approve-nopr", prNumber: null, prBranch: null });

      const entry = mq.approveForMerge(task.id);
      expect(entry).toBeNull();
    });

    it("returns existing entry on duplicate (no extra row created)", () => {
      const task = insertTask({ id: "task-approve-dup", prNumber: 5, prBranch: "feat/dup" });
      insertProject();

      const first = mq.approveForMerge(task.id);
      const second = mq.approveForMerge(task.id);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(first!.id).toBe(second!.id);

      // Verify only one row
      const allEntries = getDb().select().from(schema.mergeQueue).all();
      const taskEntries = allEntries.filter((e) => e.taskId === task.id);
      expect(taskEntries).toHaveLength(1);
    });
  });

  // ─── removeFromQueue ───────────────────────────────────────

  describe("removeFromQueue", () => {
    it("removes entry and emits queue update", () => {
      const task = insertTask({ id: "task-remove-1" });
      insertMergeQueueEntry({ taskId: task.id, id: "entry-remove-1" });

      const result = mq.removeFromQueue(task.id);

      expect(result).toBe(true);
      expect(getMergeQueueEntry("entry-remove-1")).toBeUndefined();
      expect(io.emit).toHaveBeenCalledWith("merge-queue:updated", expect.any(Object));
    });

    it("returns false for nonexistent task", () => {
      const result = mq.removeFromQueue("nonexistent-task");
      expect(result).toBe(false);
    });
  });

  // ─── onReReviewComplete ────────────────────────────────────

  describe("onReReviewComplete", () => {
    it("passed=true: status → merging, calls merge, task → done", async () => {
      const task = insertTask({ id: "task-rrc-pass", prNumber: 20, prBranch: "feat/rrc" });
      insertProject();
      const entry = insertMergeQueueEntry({
        taskId: task.id,
        prNumber: 20,
        prBranch: "feat/rrc",
        status: "re_review",
      });
      configStore.set("github:token", "test-token");
      mockMergePullRequest.mockResolvedValue(undefined);

      await mq.onReReviewComplete(task.id, true);

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("merged");

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("done");
    });

    it("passed=false: status → failed, task → in_review", async () => {
      const task = insertTask({ id: "task-rrc-fail", column: "in_progress" });
      const entry = insertMergeQueueEntry({
        taskId: task.id,
        status: "re_review",
      });

      await mq.onReReviewComplete(task.id, false);

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("failed");
      expect(dbEntry?.lastError).toContain("Re-review failed");

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("in_review");
    });

    it("no-op when entry not found", async () => {
      await mq.onReReviewComplete("nonexistent", true);
      // Should not throw
      expect(io.emit).not.toHaveBeenCalled();
    });
  });

  // ─── processEntry ──────────────────────────────────────────

  describe("processEntry", () => {
    it("rebase success + pipeline enabled → status re_review, calls startReReview", async () => {
      const task = insertTask({ id: "task-pe-rr", prNumber: 30, prBranch: "feat/pe" });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-pe-rr",
        taskId: task.id,
        prNumber: 30,
        prBranch: "feat/pe",
      });
      configStore.set("github:token", "test-token");
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);

      const mockPM = createMockPipelineManager({ isEnabled: true });
      mq.setPipelineManager(mockPM);

      await (mq as any).processEntry(entry.id);

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("re_review");
      expect(mockPM.startReReview).toHaveBeenCalledWith(task.id, "feat/pe", 30);
    });

    it("rebase success + pipeline disabled → direct merge, task → done", async () => {
      const task = insertTask({ id: "task-pe-dm", prNumber: 31, prBranch: "feat/dm" });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-pe-dm",
        taskId: task.id,
        prNumber: 31,
        prBranch: "feat/dm",
      });
      configStore.set("github:token", "test-token");
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);
      mockMergePullRequest.mockResolvedValue(undefined);

      // No pipeline manager or pipeline disabled
      const mockPM = createMockPipelineManager({ isEnabled: false });
      mq.setPipelineManager(mockPM);

      await (mq as any).processEntry(entry.id);

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("merged");

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("done");
    });

    it("calls notifyTaskDone on TeamLead after direct merge", async () => {
      const task = insertTask({ id: "task-pe-notify", prNumber: 33, prBranch: "feat/notify" });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-pe-notify",
        taskId: task.id,
        prNumber: 33,
        prBranch: "feat/notify",
      });
      configStore.set("github:token", "test-token");
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);
      mockMergePullRequest.mockResolvedValue(undefined);

      const mockPM = createMockPipelineManager({ isEnabled: false });
      mq.setPipelineManager(mockPM);

      const mockNotify = vi.fn().mockResolvedValue(undefined);
      const mockCoo = createMockCoo({ [PROJECT_ID]: { notifyTaskDone: mockNotify } });
      mq.setCoo(mockCoo);

      await (mq as any).processEntry(entry.id);

      expect(mockNotify).toHaveBeenCalledWith(task.id);
    });

    it("rebase conflict → status conflict", async () => {
      const task = insertTask({ id: "task-pe-conflict", prNumber: 32, prBranch: "feat/conflict" });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-pe-conflict",
        taskId: task.id,
        prNumber: 32,
        prBranch: "feat/conflict",
      });
      configStore.set("github:token", "test-token");
      mockRebaseBranch.mockReturnValue(false);
      mockCreateIssueComment.mockResolvedValue(undefined);

      await (mq as any).processEntry(entry.id);

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("conflict");

      // Task should be moved to backlog
      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("backlog");
    });
  });

  // ─── processNext ───────────────────────────────────────────

  describe("processNext", () => {
    it("skips when active entries exist (rebasing/re_review/merging)", async () => {
      insertTask({ id: "task-pn-active" });
      insertMergeQueueEntry({ taskId: "task-pn-active", status: "rebasing" });
      insertTask({ id: "task-pn-queued" });
      insertMergeQueueEntry({ taskId: "task-pn-queued", status: "queued", position: 1 });

      const processEntrySpy = vi.spyOn(mq as any, "processEntry");

      await (mq as any).processNext();

      expect(processEntrySpy).not.toHaveBeenCalled();
    });

    it("processes next queued entry by lowest position", async () => {
      const task1 = insertTask({ id: "task-pn-1", prNumber: 50, prBranch: "feat/1" });
      const task2 = insertTask({ id: "task-pn-2", prNumber: 51, prBranch: "feat/2" });
      insertProject();
      insertMergeQueueEntry({ id: "entry-pn-2", taskId: task2.id, position: 5, status: "queued" });
      insertMergeQueueEntry({ id: "entry-pn-1", taskId: task1.id, position: 2, status: "queued" });
      configStore.set("github:token", "test-token");
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);
      mockMergePullRequest.mockResolvedValue(undefined);

      const processEntrySpy = vi.spyOn(mq as any, "processEntry");

      await (mq as any).processNext();

      // Should process entry with position 2 (entry-pn-1)
      expect(processEntrySpy).toHaveBeenCalledWith("entry-pn-1");
    });
  });

  // ─── recover ───────────────────────────────────────────────

  describe("recover", () => {
    it("resets rebasing → queued", () => {
      insertMergeQueueEntry({ id: "entry-rec-1", status: "rebasing" });

      (mq as any).recover();

      const entry = getMergeQueueEntry("entry-rec-1");
      expect(entry?.status).toBe("queued");
    });

    it("resets re_review → queued", () => {
      insertMergeQueueEntry({ id: "entry-rec-2", status: "re_review" });

      (mq as any).recover();

      const entry = getMergeQueueEntry("entry-rec-2");
      expect(entry?.status).toBe("queued");
    });

    it("leaves merging entries untouched", () => {
      insertMergeQueueEntry({ id: "entry-rec-3", status: "merging" });

      (mq as any).recover();

      const entry = getMergeQueueEntry("entry-rec-3");
      expect(entry?.status).toBe("merging");
    });
  });

  // ─── proactive rebase ────────────────────────────────────────

  describe("proactive rebase", () => {
    it("rebases a non-next-in-line queued entry with conflicts", async () => {
      const task1 = insertTask({ id: "task-pr-1", prNumber: 70, prBranch: "feat/first" });
      const task2 = insertTask({ id: "task-pr-2", prNumber: 71, prBranch: "feat/second" });
      insertProject();
      // task1 is next-in-line (position 1), task2 is behind (position 2)
      insertMergeQueueEntry({
        id: "entry-pr-1",
        taskId: task1.id,
        prNumber: 70,
        prBranch: "feat/first",
        position: 1,
        status: "queued",
      });
      insertMergeQueueEntry({
        id: "entry-pr-2",
        taskId: task2.id,
        prNumber: 71,
        prBranch: "feat/second",
        position: 2,
        status: "queued",
      });
      configStore.set("github:token", "test-token");

      // task1's PR is mergeable, task2's PR has conflicts
      mockFetchPullRequest
        .mockResolvedValueOnce({ merged: false, state: "open", mergeable: true })
        .mockResolvedValueOnce({ merged: false, state: "open", mergeable: false });
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);

      await (mq as any).poll();

      // Should have proactively rebased entry-pr-2 (not next-in-line)
      expect(mockRebaseBranch).toHaveBeenCalledWith(
        "/workspace/test-project/repo",
        "feat/second",
        "main",
        expect.any(Object),
        expect.any(Array),
      );
      expect(mockForcePushBranch).toHaveBeenCalledWith(
        "/workspace/test-project/repo",
        "feat/second",
        expect.any(Object),
        expect.any(Array),
      );
    });

    it("skips next-in-line entry for proactive rebase (lets processNext handle it)", async () => {
      const task1 = insertTask({ id: "task-pr-only", prNumber: 72, prBranch: "feat/only" });
      insertProject();
      // Only one queued entry — it's next-in-line
      insertMergeQueueEntry({
        id: "entry-pr-only",
        taskId: task1.id,
        prNumber: 72,
        prBranch: "feat/only",
        position: 1,
        status: "queued",
      });
      configStore.set("github:token", "test-token");

      // PR has conflicts but it's the only (next-in-line) entry
      mockFetchPullRequest.mockResolvedValue({ merged: false, state: "open", mergeable: false });
      mockRebaseBranch.mockReturnValue(true);
      mockForcePushBranch.mockReturnValue(undefined);
      mockMergePullRequest.mockResolvedValue(undefined);

      const processEntrySpy = vi.spyOn(mq as any, "processEntry");

      await (mq as any).poll();

      // Should have called processEntry (not doProactiveRebase) for next-in-line
      expect(processEntrySpy).toHaveBeenCalledWith("entry-pr-only");
    });

    it("handles conflict during proactive rebase — marks conflict, moves task to backlog", async () => {
      const task1 = insertTask({ id: "task-pr-c1", prNumber: 73, prBranch: "feat/c1" });
      const task2 = insertTask({ id: "task-pr-c2", prNumber: 74, prBranch: "feat/c2" });
      insertProject();
      insertMergeQueueEntry({
        id: "entry-pr-c1",
        taskId: task1.id,
        prNumber: 73,
        prBranch: "feat/c1",
        position: 1,
        status: "queued",
      });
      insertMergeQueueEntry({
        id: "entry-pr-c2",
        taskId: task2.id,
        prNumber: 74,
        prBranch: "feat/c2",
        position: 2,
        status: "queued",
      });
      configStore.set("github:token", "test-token");

      mockFetchPullRequest
        .mockResolvedValueOnce({ merged: false, state: "open", mergeable: true })
        .mockResolvedValueOnce({ merged: false, state: "open", mergeable: false });
      mockRebaseBranch.mockReturnValue(false); // conflict
      mockCreateIssueComment.mockResolvedValue(undefined);

      await (mq as any).poll();

      const dbEntry = getMergeQueueEntry("entry-pr-c2");
      expect(dbEntry?.status).toBe("conflict");

      const dbTask = getTask(task2.id);
      expect(dbTask?.column).toBe("backlog");

      expect(mockCreateIssueComment).toHaveBeenCalled();
    });
  });

  // ─── syncExternalState ─────────────────────────────────────

  describe("syncExternalState", () => {
    it("marks entry merged when PR merged externally, task → done", async () => {
      const task = insertTask({ id: "task-sync-merged", prNumber: 60 });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-sync-merged",
        taskId: task.id,
        prNumber: 60,
        status: "queued",
      });
      configStore.set("github:token", "test-token");
      mockFetchPullRequest.mockResolvedValue({ merged: true, state: "closed" });

      await (mq as any).syncExternalState();

      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry?.status).toBe("merged");
      expect(dbEntry?.mergedAt).not.toBeNull();

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("done");
      expect(dbTask?.completionReport).toContain("merged");
    });

    it("calls notifyTaskDone on TeamLead when PR merged externally", async () => {
      const task = insertTask({ id: "task-sync-notify", prNumber: 65 });
      insertProject();
      insertMergeQueueEntry({
        id: "entry-sync-notify",
        taskId: task.id,
        prNumber: 65,
        status: "queued",
      });
      configStore.set("github:token", "test-token");
      mockFetchPullRequest.mockResolvedValue({ merged: true, state: "closed" });

      const mockNotify = vi.fn().mockResolvedValue(undefined);
      const mockCoo = createMockCoo({ [PROJECT_ID]: { notifyTaskDone: mockNotify } });
      mq.setCoo(mockCoo);

      await (mq as any).syncExternalState();

      expect(mockNotify).toHaveBeenCalledWith(task.id);
    });

    it("removes entry when PR closed without merge", async () => {
      const task = insertTask({ id: "task-sync-closed", prNumber: 61 });
      insertProject();
      const entry = insertMergeQueueEntry({
        id: "entry-sync-closed",
        taskId: task.id,
        prNumber: 61,
        status: "queued",
      });
      configStore.set("github:token", "test-token");
      mockFetchPullRequest.mockResolvedValue({ merged: false, state: "closed" });

      await (mq as any).syncExternalState();

      // Entry should be deleted
      const dbEntry = getMergeQueueEntry(entry.id);
      expect(dbEntry).toBeUndefined();

      // Task should be moved to backlog
      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("backlog");
      expect(dbTask?.assigneeAgentId).toBeNull();
    });
  });
});
