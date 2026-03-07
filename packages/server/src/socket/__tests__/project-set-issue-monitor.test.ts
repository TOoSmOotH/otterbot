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

// Mock account resolver
vi.mock("../../github/account-resolver.js", () => ({
  resolveGitHubToken: vi.fn((_projectId?: string) => configStore.get("github:token")),
  resolveGitHubUsername: vi.fn((_projectId?: string) => configStore.get("github:username")),
  resolveGitHubAccount: vi.fn((_projectId?: string) => {
    const token = configStore.get("github:token");
    if (!token) return null;
    return { id: "__legacy__", token, username: configStore.get("github:username") ?? null };
  }),
}));

// Mock github-service
vi.mock("../../github/github-service.js", () => ({
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
}));

// Mock TTS
vi.mock("../../tts/tts.js", () => ({
  isTTSEnabled: vi.fn(() => false),
  getConfiguredTTSProvider: vi.fn(() => null),
  stripMarkdown: vi.fn((s: string) => s),
}));

// Mock search providers
vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

// Mock desktop module
vi.mock("../../desktop/desktop.js", () => ({
  isDesktopEnabled: vi.fn(() => false),
  getDesktopConfig: vi.fn(() => ({})),
}));

// Mock model-packs
vi.mock("../../models3d/model-packs.js", () => ({
  getRandomModelPackId: vi.fn(() => "pack-1"),
}));

// Mock LLM adapter
vi.mock("../../llm/adapter.js", () => ({
  stream: vi.fn(),
  resolveProviderCredentials: vi.fn(() => ({ type: "anthropic" })),
}));

// Mock circuit breaker
vi.mock("../../llm/circuit-breaker.js", () => ({
  isProviderAvailable: vi.fn(() => true),
  getCircuitBreaker: vi.fn(() => ({ recordSuccess: vi.fn(), recordFailure: vi.fn(), remainingCooldownMs: 0 })),
}));

// Mock settings/model-pricing
vi.mock("../../settings/model-pricing.js", () => ({
  calculateCost: vi.fn(() => 0),
}));

// Mock kimi-tool-parser
vi.mock("../../llm/kimi-tool-parser.js", () => ({
  containsKimiToolMarkup: vi.fn(() => false),
  findToolMarkupStart: vi.fn(() => -1),
  formatToolsForPrompt: vi.fn(() => ""),
  parseKimiToolCalls: vi.fn(() => ({ cleanText: "", toolCalls: [] })),
  usesTextToolCalling: vi.fn(() => false),
}));

// Mock tool-factory
vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
}));

// Mock git utils
vi.mock("../../utils/git.js", () => ({
  initGitRepo: vi.fn(),
  createInitialCommit: vi.fn(),
}));

// Mock opencode-client
vi.mock("../../tools/opencode-client.js", () => ({
  TASK_COMPLETE_SENTINEL: "◊◊TASK_COMPLETE_9f8e7d◊◊",
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    executeTask: vi.fn().mockResolvedValue({ success: true, sessionId: "s", summary: "Done", diff: null }),
  })),
}));

import { setupSocketHandlers } from "../handlers.js";
import type { WorkspaceManager } from "../../workspace/workspace.js";

// Track socket event handlers
type SocketHandler = (...args: any[]) => void;
const socketHandlers = new Map<string, SocketHandler>();

function createMockSocket() {
  return {
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

function createMockIssueMonitor() {
  return {
    watchProject: vi.fn(),
    unwatchProject: vi.fn(),
    loadFromDb: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setPipelineManager: vi.fn(),
  };
}

function insertProject(overrides: { id: string; githubRepo?: string | null; githubIssueMonitor?: boolean }) {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id: overrides.id,
      name: "Test Project",
      description: "desc",
      status: "active",
      githubRepo: overrides.githubRepo === null ? null : (overrides.githubRepo ?? "owner/repo"),
      githubBranch: overrides.githubRepo === null ? null : "main",
      githubIssueMonitor: overrides.githubIssueMonitor ?? false,
      rules: [],
      createdAt: new Date().toISOString(),
    })
    .run();
}

describe("project:set-issue-monitor socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-issue-monitor-test-"));
    resetDb();
    configStore.clear();
    socketHandlers.clear();
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

  function setupHandler(issueMonitor?: any) {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();
    const mockWorkspace = createMockWorkspace();
    const mockIssueMonitor = issueMonitor ?? createMockIssueMonitor();

    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { workspace: mockWorkspace, issueMonitor: mockIssueMonitor as any },
    );

    return { mockSocket, mockIo, mockBus, mockCoo, mockWorkspace, mockIssueMonitor };
  }

  it("enables issue monitor for a GitHub project", async () => {
    insertProject({ id: "proj-1", githubRepo: "owner/repo", githubIssueMonitor: false });
    configStore.set("github:username", "testuser");

    const { mockIo, mockIssueMonitor } = setupHandler();
    const handler = socketHandlers.get("project:set-issue-monitor");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!({ projectId: "proj-1", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });

    // Verify DB was updated
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-1")).get();
    expect(project!.githubIssueMonitor).toBe(true);

    // Verify issue monitor was started
    expect(mockIssueMonitor.watchProject).toHaveBeenCalledWith("proj-1", "owner/repo", "testuser");

    // Verify project:updated was emitted
    expect(mockIo.emit).toHaveBeenCalledWith(
      "project:updated",
      expect.objectContaining({ id: "proj-1", githubIssueMonitor: true }),
    );
  });

  it("disables issue monitor for a GitHub project", async () => {
    insertProject({ id: "proj-2", githubRepo: "owner/repo", githubIssueMonitor: true });

    const { mockIssueMonitor } = setupHandler();
    const handler = socketHandlers.get("project:set-issue-monitor");
    const callback = vi.fn();

    await handler!({ projectId: "proj-2", enabled: false }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });

    // Verify DB was updated
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-2")).get();
    expect(project!.githubIssueMonitor).toBe(false);

    // Verify issue monitor was stopped
    expect(mockIssueMonitor.unwatchProject).toHaveBeenCalledWith("proj-2");
  });

  it("rejects when project not found", async () => {
    setupHandler();
    const handler = socketHandlers.get("project:set-issue-monitor");
    const callback = vi.fn();

    await handler!({ projectId: "nonexistent", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Project not found" }),
    );
  });

  it("rejects for non-GitHub project", async () => {
    insertProject({ id: "proj-local", githubRepo: null });

    setupHandler();
    const handler = socketHandlers.get("project:set-issue-monitor");
    const callback = vi.fn();

    await handler!({ projectId: "proj-local", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "Issue monitoring requires a GitHub repository" }),
    );
  });

  it("works without issue monitor dependency", async () => {
    insertProject({ id: "proj-3", githubRepo: "owner/repo", githubIssueMonitor: false });

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
      { workspace: mockWorkspace, issueMonitor: undefined },
    );

    const handler = socketHandlers.get("project:set-issue-monitor");
    const callback = vi.fn();

    await handler!({ projectId: "proj-3", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });

    // DB should still be updated even without issue monitor
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-3")).get();
    expect(project!.githubIssueMonitor).toBe(true);
  });
});
