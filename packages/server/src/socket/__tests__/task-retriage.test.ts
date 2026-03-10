import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

const configStore = new Map<string, string>();

const { fetchIssueMock, removeLabelFromIssueMock } = vi.hoisted(() => ({
  fetchIssueMock: vi.fn(),
  removeLabelFromIssueMock: vi.fn(),
}));

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("../../github/account-resolver.js", () => ({
  resolveGitHubToken: vi.fn((_projectId?: string) => configStore.get("github:token")),
  resolveGitHubUsername: vi.fn((_projectId?: string) => configStore.get("github:username")),
  resolveGitHubAccount: vi.fn(() => null),
}));

vi.mock("../../github/github-service.js", () => ({
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
  fetchIssue: fetchIssueMock,
  removeLabelFromIssue: removeLabelFromIssueMock,
}));

vi.mock("../../tts/tts.js", () => ({
  isTTSEnabled: vi.fn(() => false),
  getConfiguredTTSProvider: vi.fn(() => null),
  stripMarkdown: vi.fn((s: string) => s),
}));

vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

vi.mock("../../desktop/desktop.js", () => ({
  isDesktopEnabled: vi.fn(() => false),
  getDesktopConfig: vi.fn(() => ({})),
}));

vi.mock("../../models3d/model-packs.js", () => ({
  getRandomModelPackId: vi.fn(() => "pack-1"),
}));

vi.mock("../../llm/adapter.js", () => ({
  stream: vi.fn(),
  resolveProviderCredentials: vi.fn(() => ({ type: "anthropic" })),
}));

vi.mock("../../llm/circuit-breaker.js", () => ({
  isProviderAvailable: vi.fn(() => true),
  getCircuitBreaker: vi.fn(() => ({ recordSuccess: vi.fn(), recordFailure: vi.fn(), remainingCooldownMs: 0 })),
}));

vi.mock("../../settings/model-pricing.js", () => ({
  calculateCost: vi.fn(() => 0),
}));

vi.mock("../../llm/kimi-tool-parser.js", () => ({
  containsKimiToolMarkup: vi.fn(() => false),
  findToolMarkupStart: vi.fn(() => -1),
  formatToolsForPrompt: vi.fn(() => ""),
  parseKimiToolCalls: vi.fn(() => ({ cleanText: "", toolCalls: [] })),
  usesTextToolCalling: vi.fn(() => false),
}));

vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
}));

vi.mock("../../utils/git.js", () => ({
  initGitRepo: vi.fn(),
  createInitialCommit: vi.fn(),
}));

vi.mock("../../tools/opencode-client.js", () => ({
  TASK_COMPLETE_SENTINEL: "◊◊TASK_COMPLETE_9f8e7d◊◊",
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    executeTask: vi.fn().mockResolvedValue({ success: true, sessionId: "s", summary: "Done", diff: null }),
  })),
}));

import { setupSocketHandlers } from "../handlers.js";
import type { WorkspaceManager } from "../../workspace/workspace.js";

type SocketHandler = (...args: any[]) => void;
const socketHandlers = new Map<string, SocketHandler>();

function createMockSocket() {
  return {
    id: "socket-1",
    on: vi.fn((event: string, handler: SocketHandler) => {
      socketHandlers.set(event, handler);
    }),
  };
}

function createMockIo() {
  const sockets: any[] = [];
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (socket: any) => void) => {
      if (event === "connection") {
        for (const s of sockets) {
          handler(s);
        }
      }
    }),
    _addSocket: (s: any) => sockets.push(s),
  };
}

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

function createMockCoo() {
  return {
    spawnTeamLeadForManualProject: vi.fn(),
    getTeamLeads: vi.fn(() => new Map()),
    toData: vi.fn(() => ({ model: "test", provider: "test" })),
    getCurrentConversationId: vi.fn(() => null),
    destroy: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
  };
}

function createMockWorkspace(): WorkspaceManager {
  return {
    createProject: vi.fn(),
    repoPath: vi.fn((projectId: string) => `/tmp/test-workspace/projects/${projectId}/repo`),
    projectPath: vi.fn((projectId: string) => `/tmp/test-workspace/projects/${projectId}`),
    getRoot: vi.fn(() => "/tmp/test-workspace"),
    validateAccess: vi.fn(() => true),
  } as unknown as WorkspaceManager;
}

function insertProject(projectId: string, githubRepo = "owner/repo") {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: "Test Project",
      description: "desc",
      status: "active",
      githubRepo,
      githubBranch: "main",
      githubIssueMonitor: false,
      rules: [],
      createdAt: new Date().toISOString(),
    })
    .run();
}

function insertTriageTask(overrides?: Partial<typeof schema.kanbanTasks.$inferInsert>) {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.kanbanTasks)
    .values({
      id: "task-1",
      projectId: "proj-1",
      title: "Triage task",
      description: "desc",
      column: "triage",
      position: 0,
      labels: ["github-issue-42"],
      blockedBy: [],
      retryCount: 0,
      spawnCount: 0,
      pipelineStages: [],
      pipelineAttempt: 0,
      stageReports: {},
      spawnRetryCount: 0,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
}

describe("task:retriage socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-task-retriage-test-"));
    resetDb();
    configStore.clear();
    socketHandlers.clear();
    fetchIssueMock.mockReset();
    removeLabelFromIssueMock.mockReset();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupHandler(pipelineManager?: { runTriage: ReturnType<typeof vi.fn> }) {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();
    const mockWorkspace = createMockWorkspace();

    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { workspace: mockWorkspace, pipelineManager: pipelineManager as any },
    );

    return { mockIo };
  }

  it("returns an error when pipeline manager is unavailable", async () => {
    setupHandler(undefined);
    const handler = socketHandlers.get("task:retriage");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!({ taskId: "task-1", projectId: "proj-1" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Pipeline manager not available" });
  });

  it("re-triages a triage task and removes triaged label before rerun", async () => {
    insertProject("proj-1");
    insertTriageTask();
    configStore.set("github:token", "ghp_test");

    fetchIssueMock.mockResolvedValue({
      number: 42,
      title: "Issue 42",
      labels: [{ name: "triaged" }, { name: "bug" }],
    });

    const runTriage = vi.fn().mockResolvedValue(undefined);
    const { mockIo } = setupHandler({ runTriage });

    const handler = socketHandlers.get("task:retriage");
    const callback = vi.fn();
    await handler!({ taskId: "task-1", projectId: "proj-1" }, callback);

    expect(fetchIssueMock).toHaveBeenCalledWith("owner/repo", "ghp_test", 42);
    expect(removeLabelFromIssueMock).toHaveBeenCalledWith("owner/repo", "ghp_test", 42, "triaged");
    expect(runTriage).toHaveBeenCalledWith(
      "proj-1",
      "owner/repo",
      expect.objectContaining({
        number: 42,
        labels: [{ name: "bug" }],
      }),
    );
    expect(mockIo.emit).toHaveBeenCalledWith("kanban:task-deleted", { taskId: "task-1", projectId: "proj-1" });
    expect(callback).toHaveBeenCalledWith({ ok: true });

    const db = getDb();
    const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, "task-1")).get();
    expect(task).toBeUndefined();
  });

  it("restores task and reports error when re-triage fails", async () => {
    insertProject("proj-1");
    insertTriageTask();
    configStore.set("github:token", "ghp_test");

    fetchIssueMock.mockResolvedValue({
      number: 42,
      title: "Issue 42",
      labels: [{ name: "bug" }],
    });

    const runTriage = vi.fn().mockRejectedValue(new Error("triage failed"));
    const { mockIo } = setupHandler({ runTriage });

    const handler = socketHandlers.get("task:retriage");
    const callback = vi.fn();
    await handler!({ taskId: "task-1", projectId: "proj-1" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Re-triage failed; task has been restored" });
    expect(mockIo.emit).toHaveBeenCalledWith("kanban:task-deleted", { taskId: "task-1", projectId: "proj-1" });
    expect(mockIo.emit).toHaveBeenCalledWith(
      "kanban:task-created",
      expect.objectContaining({ id: "task-1", projectId: "proj-1" }),
    );

    const db = getDb();
    const task = db.select().from(schema.kanbanTasks).where(eq(schema.kanbanTasks.id, "task-1")).get();
    expect(task).toBeDefined();
    expect(task?.column).toBe("triage");
  });
});
