import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

// --- Mocks ---

const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
}));

vi.mock("../../github/github-service.js", () => ({
  createIssueComment: vi.fn().mockResolvedValue(undefined),
  addLabelsToIssue: vi.fn().mockResolvedValue(undefined),
  fetchCompareCommitsDiff: vi.fn().mockResolvedValue([]),
  fetchPullRequests: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../settings/settings.js", () => ({
  getAgentModelOverride: vi.fn(() => null),
}));

vi.mock("../../llm/adapter.js", () => ({
  resolveModel: vi.fn(() => ({})),
}));

vi.mock("ai", () => ({
  generateText: vi.fn().mockResolvedValue({ text: "{}" }),
}));

vi.mock("../../registry/registry.js", () => ({
  Registry: vi.fn().mockImplementation(() => ({
    get: vi.fn(() => ({
      id: "builtin-triage",
      systemPrompt: "test",
      defaultProvider: "anthropic",
      defaultModel: "test-model",
    })),
  })),
}));

vi.mock("../../agents/prompts/security-preamble.js", () => ({
  SECURITY_PREAMBLE: "SECURITY_PREAMBLE_STUB",
}));

vi.mock("../../utils/terminal.js", () => ({
  cleanTerminalOutput: vi.fn((s: string) => s),
}));

vi.mock("../../utils/github-comments.js", () => ({
  formatBotComment: vi.fn((...args: string[]) => args.join(" | ")),
  formatBotCommentWithDetails: vi.fn((...args: string[]) => args.join(" | ")),
}));

import { PipelineManager } from "../pipeline-manager.js";
import { createIssueComment } from "../../github/github-service.js";
import type { COO } from "../../agents/coo.js";
import { MessageType } from "@otterbot/shared";

// --- Factory helpers ---

const PROJECT_ID = "test-project";

function createMockBus() {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(() => ({
      id: "msg-1",
      fromAgentId: "",
      toAgentId: "",
      type: "report",
      content: "",
      timestamp: new Date().toISOString(),
    })),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  };
}

function createMockCOO(bus: ReturnType<typeof createMockBus>, teamLeadMap?: Map<string, { id: string }>) {
  const tlMap = teamLeadMap ?? new Map([[PROJECT_ID, { id: "tl-1" }]]);
  return {
    bus,
    getTeamLeads: vi.fn(() => tlMap),
  } as unknown as COO;
}

function createMockIO() {
  return { emit: vi.fn() } as any;
}

function createMockMergeQueue() {
  return {
    onReReviewComplete: vi.fn().mockResolvedValue(undefined),
    approveForMerge: vi.fn(() => null),
  };
}

function insertTask(overrides: Partial<{
  id: string;
  title: string;
  column: "triage" | "backlog" | "in_progress" | "in_review" | "done";
  description: string;
  assigneeAgentId: string | null;
  position: number;
  labels: string[];
  blockedBy: string[];
  retryCount: number;
  completionReport: string | null;
  prNumber: number | null;
  prBranch: string | null;
  pipelineStage: string | null;
  pipelineStages: string[];
  stageReports: Record<string, string>;
  lastKickbackSource: string | null;
  spawnRetryCount: number;
  spawnCount: number;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const task = {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT_ID,
    title: overrides.title ?? "Test task",
    description: overrides.description ?? "",
    column: overrides.column ?? ("backlog" as const),
    position: overrides.position ?? 0,
    assigneeAgentId: overrides.assigneeAgentId ?? null,
    createdBy: "test",
    labels: overrides.labels ?? [],
    blockedBy: overrides.blockedBy ?? [],
    retryCount: overrides.retryCount ?? 0,
    spawnCount: overrides.spawnCount ?? 0,
    completionReport: overrides.completionReport ?? null,
    prNumber: overrides.prNumber ?? null,
    prBranch: overrides.prBranch ?? null,
    pipelineStage: overrides.pipelineStage ?? null,
    pipelineStages: overrides.pipelineStages ?? [],
    stageReports: overrides.stageReports ?? {},
    lastKickbackSource: overrides.lastKickbackSource ?? null,
    spawnRetryCount: overrides.spawnRetryCount ?? 0,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.kanbanTasks).values(task).run();
  return task;
}

function insertProject(overrides: Partial<{
  id: string;
  name: string;
  githubRepo: string;
  githubBranch: string;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const project = {
    id: overrides.id ?? PROJECT_ID,
    name: overrides.name ?? "Test Project",
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

function getTask(taskId: string) {
  return getDb()
    .select()
    .from(schema.kanbanTasks)
    .where(eq(schema.kanbanTasks.id, taskId))
    .get();
}

interface PipelineState {
  taskId: string;
  projectId: string;
  issueNumber: number | null;
  repo: string | null;
  stages: string[];
  currentStageIndex: number;
  spawnRetryCount: number;
  lastKickbackSource: string | null;
  stageReports: Map<string, string>;
  prBranch: string | null;
  prNumber: number | null;
  targetBranch: string;
  isReReview?: boolean;
}

function createPipelineState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    taskId: overrides.taskId ?? "task-1",
    projectId: overrides.projectId ?? PROJECT_ID,
    issueNumber: overrides.issueNumber ?? null,
    repo: overrides.repo ?? null,
    stages: overrides.stages ?? ["coder", "security", "tester", "reviewer"],
    currentStageIndex: overrides.currentStageIndex ?? 0,
    spawnRetryCount: overrides.spawnRetryCount ?? 0,
    lastKickbackSource: overrides.lastKickbackSource ?? null,
    stageReports: overrides.stageReports ?? new Map(),
    prBranch: overrides.prBranch ?? null,
    prNumber: overrides.prNumber ?? null,
    targetBranch: overrides.targetBranch ?? "main",
    isReReview: overrides.isReReview ?? false,
  };
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

// --- Tests ---

describe("PipelineManager", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let io: ReturnType<typeof createMockIO>;
  let coo: COO;
  let pm: PipelineManager;
  let mq: ReturnType<typeof createMockMergeQueue>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-pm-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    io = createMockIO();
    coo = createMockCOO(bus);
    pm = new PipelineManager(coo, io);
    mq = createMockMergeQueue();
    pm.setMergeQueue(mq);
  });

  afterEach(() => {
    pm.dispose();
    resetDb();
    configStore.clear();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ─── handleSpawnFailure ────────────────────────────────────

  describe("handleSpawnFailure", () => {
    it("returns early when no pipeline state exists", async () => {
      await pm.handleSpawnFailure("nonexistent-task", "Error spawning worker");
      // Should not throw, no side effects
      expect(mq.onReReviewComplete).not.toHaveBeenCalled();
    });

    it("increments spawnRetryCount and persists to DB", async () => {
      vi.useFakeTimers();
      const task = insertTask({ id: "task-spawn-1", column: "in_progress" });
      const state = createPipelineState({ taskId: task.id });
      (pm as any).pipelines.set(task.id, state);

      await pm.handleSpawnFailure(task.id, "Error spawning worker");

      expect(state.spawnRetryCount).toBe(1);
      const dbTask = getTask(task.id);
      expect(dbTask?.spawnRetryCount).toBe(1);
      vi.useRealTimers();
    });

    it("schedules retry with 10s × retryCount backoff", async () => {
      vi.useFakeTimers();
      const task = insertTask({ id: "task-spawn-2", column: "in_progress" });
      insertProject();
      setPipelineConfig(PROJECT_ID);
      const state = createPipelineState({ taskId: task.id });
      (pm as any).pipelines.set(task.id, state);

      await pm.handleSpawnFailure(task.id, "Error spawning worker: timeout");

      // retryCount is now 1, so delay = 10_000 * 1 = 10s
      expect(state.spawnRetryCount).toBe(1);

      // The sendStageDirective should not have been called yet
      expect(bus.send).not.toHaveBeenCalled();

      // Advance timer by 10s
      await vi.advanceTimersByTimeAsync(10_000);

      // Now sendStageDirective should have fired, calling bus.send
      expect(bus.send).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("uses 30s × retryCount backoff for concurrency refusals", async () => {
      vi.useFakeTimers();
      const task = insertTask({ id: "task-spawn-3", column: "in_progress" });
      insertProject();
      setPipelineConfig(PROJECT_ID);
      const state = createPipelineState({ taskId: task.id });
      (pm as any).pipelines.set(task.id, state);

      await pm.handleSpawnFailure(task.id, "REFUSED: worker already running for this project");

      expect(state.spawnRetryCount).toBe(1);

      // Should NOT fire at 10s
      await vi.advanceTimersByTimeAsync(10_000);
      expect(bus.send).not.toHaveBeenCalled();

      // Should fire at 30s
      await vi.advanceTimersByTimeAsync(20_000);
      expect(bus.send).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("max retries exhausted (normal): appends error, posts comment, moves to backlog", async () => {
      const task = insertTask({
        id: "task-spawn-max",
        column: "in_progress",
        description: "Original desc",
      });
      insertProject();
      configStore.set("github:token", "test-token");
      const state = createPipelineState({
        taskId: task.id,
        spawnRetryCount: 3, // will become 4, exceeding MAX_SPAWN_RETRIES (3)
        issueNumber: 42,
        repo: "owner/repo",
      });
      (pm as any).pipelines.set(task.id, state);

      await pm.handleSpawnFailure(task.id, "Error spawning worker: out of memory");

      // Task should be moved to backlog
      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("backlog");
      expect(dbTask?.pipelineStage).toBeNull();
      expect(dbTask?.assigneeAgentId).toBeNull();
      expect(dbTask?.description).toContain("Pipeline spawn failed");

      // GitHub comment should have been posted
      expect(createIssueComment).toHaveBeenCalled();

      // Pipeline should be deleted from memory
      expect((pm as any).pipelines.has(task.id)).toBe(false);
    });

    it("max retries exhausted (re-review): calls mergeQueue.onReReviewComplete, does NOT move to backlog", async () => {
      const task = insertTask({
        id: "task-spawn-rr",
        column: "in_progress",
        description: "Re-review task",
      });
      const state = createPipelineState({
        taskId: task.id,
        spawnRetryCount: 3,
        isReReview: true,
      });
      (pm as any).pipelines.set(task.id, state);

      await pm.handleSpawnFailure(task.id, "Error spawning worker");

      // Should call mergeQueue instead of moving to backlog
      expect(mq.onReReviewComplete).toHaveBeenCalledWith(task.id, false);

      // Pipeline should be deleted
      expect((pm as any).pipelines.has(task.id)).toBe(false);

      // Task should NOT be moved to backlog (merge queue handles it)
      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("in_progress");
    });
  });

  // ─── sendStageDirective ────────────────────────────────────

  describe("sendStageDirective", () => {
    it("sends directive via bus with correct metadata", async () => {
      const task = insertTask({ id: "task-dir-1", column: "in_progress", title: "Implement feature" });
      insertProject();
      setPipelineConfig(PROJECT_ID);
      const state = createPipelineState({
        taskId: task.id,
        prBranch: "feat/test-branch",
        stages: ["coder", "reviewer"],
        currentStageIndex: 0,
      });
      (pm as any).pipelines.set(task.id, state);

      await (pm as any).sendStageDirective(state);

      expect(bus.send).toHaveBeenCalledTimes(1);
      const call = (bus.send as any).mock.calls[0][0];
      expect(call.type).toBe(MessageType.Directive);
      expect(call.metadata.pipelineTaskId).toBe(task.id);
      expect(call.metadata.pipelineBranch).toBe("feat/test-branch");
      expect(call.metadata.pipelineIsReReview).toBe(false);
    });

    it("sets pipelineIsReReview: true when state.isReReview is true", async () => {
      const task = insertTask({ id: "task-dir-rr", column: "in_progress" });
      insertProject();
      setPipelineConfig(PROJECT_ID);
      const state = createPipelineState({
        taskId: task.id,
        stages: ["security", "reviewer"],
        currentStageIndex: 0,
        isReReview: true,
        prBranch: "feat/rr-branch",
      });
      (pm as any).pipelines.set(task.id, state);

      await (pm as any).sendStageDirective(state);

      const call = (bus.send as any).mock.calls[0][0];
      expect(call.metadata.pipelineIsReReview).toBe(true);
    });

    it("falls back to backlog when no TeamLead found", async () => {
      const emptyTlMap = new Map();
      const cooCopy = createMockCOO(bus, emptyTlMap);
      const pm2 = new PipelineManager(cooCopy, io);

      const task = insertTask({ id: "task-dir-notl", column: "in_progress" });
      insertProject();
      setPipelineConfig(PROJECT_ID);
      const state = createPipelineState({ taskId: task.id });
      (pm2 as any).pipelines.set(task.id, state);

      await (pm2 as any).sendStageDirective(state);

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("backlog");
      expect((pm2 as any).pipelines.has(task.id)).toBe(false);
      pm2.dispose();
    });
  });

  // ─── startReReview ─────────────────────────────────────────

  describe("startReReview", () => {
    it("creates pipeline with isReReview: true and review-only stages", async () => {
      const task = insertTask({ id: "task-rr-1", column: "in_review" });
      insertProject();
      setPipelineConfig(PROJECT_ID);

      await pm.startReReview(task.id, "feat/rr-branch", 42);

      const state = (pm as any).pipelines.get(task.id);
      expect(state).toBeDefined();
      expect(state.isReReview).toBe(true);
      expect(state.stages).not.toContain("coder");
      expect(state.stages).toContain("security");
      expect(state.stages).toContain("tester");
      expect(state.stages).toContain("reviewer");
    });

    it("calls mergeQueue.onReReviewComplete(true) directly when no review stages enabled", async () => {
      const task = insertTask({ id: "task-rr-noreview", column: "in_review" });
      insertProject();
      // Disable all review stages
      setPipelineConfig(PROJECT_ID, {
        security: { enabled: false },
        tester: { enabled: false },
        reviewer: { enabled: false },
      });

      await pm.startReReview(task.id, "feat/branch", 10);

      expect(mq.onReReviewComplete).toHaveBeenCalledWith(task.id, true);
    });

    it("updates kanban task pipelineStage and pipelineStages in DB", async () => {
      const task = insertTask({ id: "task-rr-db", column: "in_review" });
      insertProject();
      setPipelineConfig(PROJECT_ID);

      await pm.startReReview(task.id, "feat/rr-db", 99);

      const dbTask = getTask(task.id);
      expect(dbTask?.pipelineStage).toBe("security");
      expect(dbTask?.pipelineStages).toContain("security");
      expect(dbTask?.pipelineStages).not.toContain("coder");
    });
  });

  // ─── persistPipelineState ──────────────────────────────────

  describe("persistPipelineState", () => {
    it("persists stageReports, lastKickbackSource, spawnRetryCount to DB", () => {
      const task = insertTask({ id: "task-persist-1", column: "in_progress" });
      const state = createPipelineState({
        taskId: task.id,
        spawnRetryCount: 2,
        lastKickbackSource: "security",
        stageReports: new Map([["coder", "coder report here"]]),
      });

      (pm as any).persistPipelineState(state);

      const dbTask = getTask(task.id);
      expect(dbTask?.spawnRetryCount).toBe(2);
      expect(dbTask?.lastKickbackSource).toBe("security");
      expect((dbTask?.stageReports as Record<string, string>)?.coder).toBe("coder report here");
    });
  });

  // ─── resetTaskToBacklog ────────────────────────────────────

  describe("resetTaskToBacklog", () => {
    it("sets column=backlog, clears pipelineStage and assigneeAgentId, emits event", () => {
      const task = insertTask({
        id: "task-reset-1",
        column: "in_progress",
        pipelineStage: "coder",
        assigneeAgentId: "worker-1",
      });

      (pm as any).resetTaskToBacklog(task.id);

      const dbTask = getTask(task.id);
      expect(dbTask?.column).toBe("backlog");
      expect(dbTask?.pipelineStage).toBeNull();
      expect(dbTask?.assigneeAgentId).toBeNull();
      expect(io.emit).toHaveBeenCalledWith("kanban:task-updated", expect.objectContaining({ id: task.id }));
    });
  });

  // ─── recoverPipelines ──────────────────────────────────────

  describe("recoverPipelines", () => {
    it("reconstructs in-memory pipeline state from DB", () => {
      insertProject();
      insertTask({
        id: "task-recover-1",
        column: "in_progress",
        pipelineStage: "tester",
        pipelineStages: ["coder", "security", "tester", "reviewer"],
        stageReports: { coder: "coder done", security: "no issues" },
        spawnRetryCount: 1,
        lastKickbackSource: "security",
        labels: ["github-issue-55"],
        prBranch: "feat/issue-55",
        prNumber: 88,
      });

      (pm as any).recoverPipelines();

      const state = (pm as any).pipelines.get("task-recover-1");
      expect(state).toBeDefined();
      expect(state.currentStageIndex).toBe(2); // tester is index 2
      expect(state.spawnRetryCount).toBe(1);
      expect(state.lastKickbackSource).toBe("security");
      expect(state.stageReports.get("coder")).toBe("coder done");
      expect(state.stageReports.get("security")).toBe("no issues");
      expect(state.prBranch).toBe("feat/issue-55");
      expect(state.prNumber).toBe(88);
      expect(state.issueNumber).toBe(55);
    });

    it("skips tasks with invalid/missing stage index", () => {
      insertProject();
      insertTask({
        id: "task-recover-bad",
        column: "in_progress",
        pipelineStage: "nonexistent-stage",
        pipelineStages: ["coder", "reviewer"],
      });

      (pm as any).recoverPipelines();

      expect((pm as any).pipelines.has("task-recover-bad")).toBe(false);
    });
  });
});
