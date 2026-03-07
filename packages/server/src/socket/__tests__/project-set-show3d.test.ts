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

function insertProject(projectId: string, show3d = true) {
  const db = getDb();
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: "Project 1",
      description: "desc",
      status: "active",
      createdAt: new Date().toISOString(),
      githubIssueMonitor: false,
      show3d,
      rules: [],
    })
    .run();
}

describe("project:set-show3d socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-project-show3d-test-"));
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

  function setupHandler(worldLayout?: any) {
    const mockSocket = createMockSocket();
    const mockIo = createMockIo();
    const mockBus = createMockBus();
    const mockCoo = createMockCoo();
    const mockRegistry = createMockRegistry();

    mockIo._addSocket(mockSocket);

    setupSocketHandlers(
      mockIo as any,
      mockBus as any,
      mockCoo as any,
      mockRegistry as any,
      undefined,
      { worldLayout },
    );

    return { mockIo };
  }

  it("disables 3D view, removes zone, and emits project update", () => {
    const worldLayout = {
      removeZone: vi.fn(() => true),
      loadZoneConfig: vi.fn(),
      addZone: vi.fn(),
    };
    const { mockIo } = setupHandler(worldLayout);
    insertProject("proj-1", true);

    const handler = socketHandlers.get("project:set-show3d");
    const callback = vi.fn();
    handler?.({ projectId: "proj-1", enabled: false }, callback);

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-1")).get();

    expect(project?.show3d).toBe(false);
    expect(worldLayout.removeZone).toHaveBeenCalledWith("proj-1");
    expect(worldLayout.loadZoneConfig).not.toHaveBeenCalled();
    expect(worldLayout.addZone).not.toHaveBeenCalled();
    expect(mockIo.emit).toHaveBeenCalledWith("world:zone-removed", { projectId: "proj-1" });
    expect(mockIo.emit).toHaveBeenCalledWith("project:updated", expect.objectContaining({ id: "proj-1", show3d: false }));
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("enables 3D view and adds zone when one is not present", () => {
    const zone = { id: "zone-1", projectId: "proj-2", label: "Project 2" };
    const worldLayout = {
      removeZone: vi.fn(),
      loadZoneConfig: vi.fn(() => null),
      addZone: vi.fn(() => zone),
    };
    const { mockIo } = setupHandler(worldLayout);
    insertProject("proj-2", false);

    const handler = socketHandlers.get("project:set-show3d");
    const callback = vi.fn();
    handler?.({ projectId: "proj-2", enabled: true }, callback);

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-2")).get();

    expect(project?.show3d).toBe(true);
    expect(worldLayout.removeZone).not.toHaveBeenCalled();
    expect(worldLayout.loadZoneConfig).toHaveBeenCalledWith("proj-2");
    expect(worldLayout.addZone).toHaveBeenCalledWith("proj-2", "default-project-office", "Project 1");
    expect(mockIo.emit).toHaveBeenCalledWith("world:zone-added", { zone });
    expect(mockIo.emit).toHaveBeenCalledWith("project:updated", expect.objectContaining({ id: "proj-2", show3d: true }));
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("does not add zone when enabling and zone already exists", () => {
    const worldLayout = {
      removeZone: vi.fn(),
      loadZoneConfig: vi.fn(() => ({ id: "existing-zone" })),
      addZone: vi.fn(),
    };
    const { mockIo } = setupHandler(worldLayout);
    insertProject("proj-3", false);

    const handler = socketHandlers.get("project:set-show3d");
    const callback = vi.fn();
    handler?.({ projectId: "proj-3", enabled: true }, callback);

    expect(worldLayout.loadZoneConfig).toHaveBeenCalledWith("proj-3");
    expect(worldLayout.addZone).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalledWith("world:zone-added", expect.anything());
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("does not emit zone removal when disabling and no zone was removed", () => {
    const worldLayout = {
      removeZone: vi.fn(() => false),
      loadZoneConfig: vi.fn(),
      addZone: vi.fn(),
    };
    const { mockIo } = setupHandler(worldLayout);
    insertProject("proj-4", true);

    const handler = socketHandlers.get("project:set-show3d");
    const callback = vi.fn();
    handler?.({ projectId: "proj-4", enabled: false }, callback);

    const db = getDb();
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-4")).get();

    expect(project?.show3d).toBe(false);
    expect(worldLayout.removeZone).toHaveBeenCalledWith("proj-4");
    expect(mockIo.emit).not.toHaveBeenCalledWith("world:zone-removed", expect.anything());
    expect(mockIo.emit).toHaveBeenCalledWith("project:updated", expect.objectContaining({ id: "proj-4", show3d: false }));
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("returns not found for missing project", () => {
    const worldLayout = {
      removeZone: vi.fn(),
      loadZoneConfig: vi.fn(),
      addZone: vi.fn(),
    };
    const { mockIo } = setupHandler(worldLayout);

    const handler = socketHandlers.get("project:set-show3d");
    const callback = vi.fn();
    handler?.({ projectId: "missing-project", enabled: false }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Project not found" });
    expect(worldLayout.removeZone).not.toHaveBeenCalled();
    expect(worldLayout.loadZoneConfig).not.toHaveBeenCalled();
    expect(worldLayout.addZone).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalledWith("project:updated", expect.anything());
  });
});
