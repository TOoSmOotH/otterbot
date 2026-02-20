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
const mockCloneRepo = vi.fn();
const mockGetRepoDefaultBranch = vi.fn().mockResolvedValue("main");
vi.mock("../../github/github-service.js", () => ({
  cloneRepo: (...args: any[]) => mockCloneRepo(...args),
  getRepoDefaultBranch: (...args: any[]) => mockGetRepoDefaultBranch(...args),
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
        // Auto-call with each registered socket
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

describe("project:create-manual socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-socket-gh-test-"));
    resetDb();
    configStore.clear();
    socketHandlers.clear();
    mockCloneRepo.mockReset();
    mockGetRepoDefaultBranch.mockReset().mockResolvedValue("main");
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

  function setupHandler() {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();
    const mockWorkspace = createMockWorkspace();

    // Register the socket before calling setup so on("connection") fires
    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { workspace: mockWorkspace, issueMonitor: undefined },
    );

    return { mockSocket, mockIo, mockBus, mockCoo, mockWorkspace };
  }

  it("rejects when GitHub is not configured", async () => {
    const { mockCoo } = setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!(
      { name: "test", description: "desc", githubRepo: "owner/repo" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("GitHub is not configured"),
      }),
    );
    expect(mockCoo.spawnTeamLeadForManualProject).not.toHaveBeenCalled();
  });

  it("rejects invalid repo format", async () => {
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "testuser");

    setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    const callback = vi.fn();

    await handler!(
      { name: "test", description: "desc", githubRepo: "invalid-format" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("Invalid repo format"),
      }),
    );
  });

  it("creates a project successfully", async () => {
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "testuser");

    const { mockCoo, mockIo, mockWorkspace } = setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    const callback = vi.fn();

    await handler!(
      {
        name: "My Project",
        description: "A test project",
        githubRepo: "owner/repo",
        githubBranch: "dev",
        rules: ["Sign commits"],
        issueMonitor: false,
      },
      callback,
    );

    // Should succeed
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, projectId: expect.any(String) }),
    );

    // Verify project was created in DB
    const projectId = callback.mock.calls[0][0].projectId;
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();

    expect(project).toBeDefined();
    expect(project!.name).toBe("My Project");
    expect(project!.githubRepo).toBe("owner/repo");
    expect(project!.githubBranch).toBe("dev");
    expect(project!.rules).toEqual(["Sign commits"]);

    // Verify workspace was created
    expect(mockWorkspace.createProject).toHaveBeenCalledWith(projectId);

    // Verify repo was cloned
    expect(mockCloneRepo).toHaveBeenCalledWith(
      "owner/repo",
      expect.stringContaining(projectId),
      "dev",
    );

    // Verify TeamLead was spawned
    expect(mockCoo.spawnTeamLeadForManualProject).toHaveBeenCalledWith(
      projectId,
      "owner/repo",
      "dev",
      ["Sign commits"],
    );

    // Verify project:created was emitted
    expect(mockIo.emit).toHaveBeenCalledWith(
      "project:created",
      expect.objectContaining({ id: projectId }),
    );

    // Verify GitHub config was stored in KV
    expect(configStore.get(`project:${projectId}:github:repo`)).toBe("owner/repo");
    expect(configStore.get(`project:${projectId}:github:branch`)).toBe("dev");
    expect(configStore.get(`project:${projectId}:github:rules`)).toBe(JSON.stringify(["Sign commits"]));
  });

  it("fetches default branch when not provided", async () => {
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "testuser");
    mockGetRepoDefaultBranch.mockResolvedValue("develop");

    setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    const callback = vi.fn();

    await handler!(
      { name: "test", description: "desc", githubRepo: "owner/repo" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

    // Verify default branch was fetched
    expect(mockGetRepoDefaultBranch).toHaveBeenCalledWith("owner/repo", "ghp_test");

    // Verify project uses the fetched branch
    const projectId = callback.mock.calls[0][0].projectId;
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(project!.githubBranch).toBe("develop");
  });

  it("auto-fills name from repo when not provided", async () => {
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "testuser");

    setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    const callback = vi.fn();

    await handler!(
      { name: "", description: "", githubRepo: "owner/my-cool-repo" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));

    const projectId = callback.mock.calls[0][0].projectId;
    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(project!.name).toBe("my-cool-repo");
  });

  it("cleans up on clone failure", async () => {
    configStore.set("github:token", "ghp_test");
    configStore.set("github:username", "testuser");
    mockCloneRepo.mockImplementation(() => {
      throw new Error("Authentication failed");
    });

    setupHandler();
    const handler = socketHandlers.get("project:create-manual");
    const callback = vi.fn();

    await handler!(
      { name: "test", description: "desc", githubRepo: "owner/repo" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("Authentication failed"),
      }),
    );

    // Verify project was cleaned up from DB
    const db = getDb();
    const projects = db.select().from(schema.projects).all();
    expect(projects).toHaveLength(0);
  });
});
