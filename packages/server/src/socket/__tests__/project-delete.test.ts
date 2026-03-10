import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
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
    send: vi.fn(),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  };
}

function createMockCoo() {
  return {
    destroyProject: vi.fn(),
    clearProjectConversations: vi.fn(),
    getTeamLeads: vi.fn(() => new Map()),
    toData: vi.fn(() => ({ model: "test", provider: "test" })),
    getCurrentConversationId: vi.fn(() => null),
    loadConversation: vi.fn(),
    destroy: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
  };
}

describe("project:delete socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-project-delete-test-"));
    resetDb();
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

  function setupHandler(removeZoneResult?: boolean) {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();
    const worldLayout = removeZoneResult === undefined
      ? undefined
      : { removeZone: vi.fn(() => removeZoneResult) };

    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { worldLayout: worldLayout as any },
    );

    return { mockIo, mockCoo, worldLayout };
  }

  function insertProject(projectId: string) {
    const db = getDb();
    db.insert(schema.projects).values({
      id: projectId,
      name: "Project 1",
      description: "desc",
      status: "active",
      charter: "Project charter",
      charterStatus: "finalized",
      createdAt: new Date().toISOString(),
      githubIssueMonitor: false,
      rules: [],
    }).run();
  }

  it("removes the 3D zone and emits world:zone-removed when a deleted project has a zone", () => {
    const { mockIo, mockCoo, worldLayout } = setupHandler(true);
    insertProject("proj-1");

    const handler = socketHandlers.get("project:delete");
    const callback = vi.fn();
    handler?.({ projectId: "proj-1" }, callback);

    expect(mockCoo.destroyProject).toHaveBeenCalledWith("proj-1");
    expect(mockCoo.clearProjectConversations).toHaveBeenCalledWith("proj-1");
    expect(worldLayout?.removeZone).toHaveBeenCalledWith("proj-1");
    expect(mockIo.emit).toHaveBeenCalledWith("world:zone-removed", { projectId: "proj-1" });
    expect(mockIo.emit).toHaveBeenCalledWith("project:deleted", { projectId: "proj-1" });
    expect(callback).toHaveBeenCalledWith({ ok: true });

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-1")).get();
    expect(project).toBeUndefined();
  });

  it("does not emit world:zone-removed when no zone was removed", () => {
    const { mockIo, worldLayout } = setupHandler(false);
    insertProject("proj-2");

    const handler = socketHandlers.get("project:delete");
    const callback = vi.fn();
    handler?.({ projectId: "proj-2" }, callback);

    expect(worldLayout?.removeZone).toHaveBeenCalledWith("proj-2");
    expect(mockIo.emit).not.toHaveBeenCalledWith("world:zone-removed", { projectId: "proj-2" });
    expect(mockIo.emit).toHaveBeenCalledWith("project:deleted", { projectId: "proj-2" });
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("returns not found and skips cleanup when the project does not exist", () => {
    const { mockIo, mockCoo, worldLayout } = setupHandler(true);

    const handler = socketHandlers.get("project:delete");
    const callback = vi.fn();
    handler?.({ projectId: "missing-project" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Project not found" });
    expect(mockCoo.destroyProject).not.toHaveBeenCalled();
    expect(mockCoo.clearProjectConversations).not.toHaveBeenCalled();
    expect(worldLayout?.removeZone).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalledWith("project:deleted", { projectId: "missing-project" });
  });
});
