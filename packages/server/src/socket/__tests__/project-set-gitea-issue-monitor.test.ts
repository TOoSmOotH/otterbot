import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

const configStore = new Map<string, string>();
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

vi.mock("../../gitea/account-resolver.js", () => ({
  resolveGiteaUsername: vi.fn((_projectId?: string) => configStore.get("gitea:username")),
}));

vi.mock("../../github/github-service.js", () => ({
  cloneRepo: vi.fn(),
  getRepoDefaultBranch: vi.fn().mockResolvedValue("main"),
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

function insertProject(overrides: {
  id: string;
  giteaRepo?: string | null;
  giteaIssueMonitor?: boolean;
  giteaAccountId?: string | null;
}) {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id: overrides.id,
      name: "Test Project",
      description: "desc",
      status: "active",
      giteaRepo: overrides.giteaRepo === null ? null : (overrides.giteaRepo ?? "owner/repo"),
      giteaBranch: overrides.giteaRepo === null ? null : "main",
      giteaIssueMonitor: overrides.giteaIssueMonitor ?? false,
      giteaAccountId: overrides.giteaAccountId ?? null,
      rules: [],
      createdAt: new Date().toISOString(),
    })
    .run();
}

describe("project:set-gitea-issue-monitor socket handlers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gitea-issue-monitor-test-"));
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

  function setupHandler(giteaIssueMonitor?: any) {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();
    const mockWorkspace = createMockWorkspace();
    const mockGiteaIssueMonitor = giteaIssueMonitor ?? createMockIssueMonitor();

    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { workspace: mockWorkspace, giteaIssueMonitor: mockGiteaIssueMonitor as any },
    );

    return { mockIo, mockGiteaIssueMonitor };
  }

  it("enables gitea issue monitor and watches project", async () => {
    insertProject({ id: "proj-1", giteaRepo: "owner/repo", giteaIssueMonitor: false });
    configStore.set("gitea:username", "gitea-bot");

    const { mockIo, mockGiteaIssueMonitor } = setupHandler();
    const handler = socketHandlers.get("project:set-gitea-issue-monitor");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!({ projectId: "proj-1", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-1")).get();
    expect(project!.giteaIssueMonitor).toBe(true);

    expect(mockGiteaIssueMonitor.watchProject).toHaveBeenCalledWith(
      "proj-1",
      "owner/repo",
      "gitea-bot",
    );

    expect(mockIo.emit).toHaveBeenCalledWith(
      "project:updated",
      expect.objectContaining({ id: "proj-1", giteaIssueMonitor: true }),
    );
  });

  it("disables gitea issue monitor and unwatches project", async () => {
    insertProject({ id: "proj-2", giteaRepo: "owner/repo", giteaIssueMonitor: true });

    const { mockGiteaIssueMonitor } = setupHandler();
    const handler = socketHandlers.get("project:set-gitea-issue-monitor");

    const callback = vi.fn();
    await handler!({ projectId: "proj-2", enabled: false }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });
    expect(mockGiteaIssueMonitor.unwatchProject).toHaveBeenCalledWith("proj-2");

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-2")).get();
    expect(project!.giteaIssueMonitor).toBe(false);
  });

  it("rejects monitor enable when project has no gitea repo", async () => {
    insertProject({ id: "proj-local", giteaRepo: null });

    setupHandler();
    const handler = socketHandlers.get("project:set-gitea-issue-monitor");
    const callback = vi.fn();

    await handler!({ projectId: "proj-local", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: "No Gitea repo configured for this project" }),
    );
  });

  it("sets gitea account id on a project", async () => {
    insertProject({ id: "proj-3", giteaRepo: "owner/repo", giteaAccountId: null });

    setupHandler();
    const handler = socketHandlers.get("project:set-gitea-account");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    await handler!({ projectId: "proj-3", accountId: "acct-42" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: true });

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-3")).get();
    expect(project!.giteaAccountId).toBe("acct-42");
  });
});
