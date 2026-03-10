import { describe, it, expect, beforeEach, vi } from "vitest";

const configStore = new Map<string, string>();
const mockSetConfig = vi.fn((key: string, value: string) => configStore.set(key, value));
let throwOnGetConfig = false;

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => {
    if (throwOnGetConfig) {
      throw new Error("read failed");
    }
    return configStore.get(key);
  }),
  setConfig: (...args: unknown[]) => mockSetConfig(...args),
  deleteConfig: vi.fn(),
}));

// Mock DB so project-existence checks pass
const mockDbGet = vi.fn();
vi.mock("../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: () => mockDbGet() }) }) }),
  }),
  schema: {
    projects: { id: "id" },
  },
}));

import { setupSocketHandlers } from "../handlers.js";

type SocketHandler = (...args: any[]) => void | Promise<void>;

const socketHandlers = new Map<string, SocketHandler>();

function createMockSocket() {
  return {
    id: "socket-1",
    on: vi.fn((event: string, handler: SocketHandler) => {
      socketHandlers.set(event, handler);
    }),
    emit: vi.fn(),
  };
}

function createMockIo() {
  const sockets: any[] = [];
  return {
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (socket: any) => void) => {
      if (event === "connection") {
        for (const socket of sockets) handler(socket);
      }
    }),
    _addSocket: (s: any) => sockets.push(s),
  };
}

function createMockBus() {
  return {
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(),
    getHistory: vi.fn(),
    request: vi.fn(),
  };
}

function createMockCoo() {
  return {
    getCurrentConversationId: vi.fn(() => null),
    resetConversation: vi.fn(),
    startNewConversation: vi.fn(),
    toData: vi.fn(() => ({ model: "test", provider: "test" })),
    getTeamLeads: vi.fn(() => new Map()),
    destroy: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    list: vi.fn(() => []),
    get: vi.fn(() => null),
  };
}

function setupHandlers() {
  socketHandlers.clear();
  const mockSocket = createMockSocket();
  const mockIo = createMockIo();
  mockIo._addSocket(mockSocket);
  setupSocketHandlers(
    mockIo as any,
    createMockBus() as any,
    createMockCoo() as any,
    createMockRegistry() as any,
  );
}

describe("fork settings socket handlers", () => {
  beforeEach(() => {
    configStore.clear();
    throwOnGetConfig = false;
    mockSetConfig.mockClear();
    // Default: project exists
    mockDbGet.mockReturnValue({ id: "proj-1" });
  });

  it("returns fork settings and defaults forkUpstreamPr to true when unset", () => {
    configStore.set("project:proj-1:github:fork_mode", "true");
    configStore.set("project:proj-1:github:fork_repo", "botuser/repo");
    setupHandlers();
    const handler = socketHandlers.get("project:get-fork-settings");
    const callback = vi.fn();

    handler?.({ projectId: "proj-1" }, callback);

    expect(callback).toHaveBeenCalledWith({
      forkMode: true,
      forkRepo: "botuser/repo",
      forkUpstreamPr: true,
    });
  });

  it("returns fallback defaults when fork settings retrieval throws", () => {
    setupHandlers();
    const handler = socketHandlers.get("project:get-fork-settings");
    const callback = vi.fn();
    throwOnGetConfig = true;

    handler?.({ projectId: "proj-1" }, callback);

    expect(callback).toHaveBeenCalledWith({
      forkMode: false,
      forkRepo: null,
      forkUpstreamPr: true,
    });
  });

  it("persists fork upstream PR setting", () => {
    setupHandlers();
    const handler = socketHandlers.get("project:set-fork-upstream-pr");
    const callback = vi.fn();

    handler?.({ projectId: "proj-1", enabled: false }, callback);

    expect(mockSetConfig).toHaveBeenCalledWith(
      "project:proj-1:github:fork_upstream_pr",
      "false",
    );
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("returns error payload when persisting fork upstream PR setting fails", () => {
    setupHandlers();
    const handler = socketHandlers.get("project:set-fork-upstream-pr");
    const callback = vi.fn();
    mockSetConfig.mockImplementationOnce(() => {
      throw new Error("write failed");
    });

    handler?.({ projectId: "proj-1", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "write failed" });
  });

  it("returns defaults when projectId is missing for get-fork-settings", () => {
    setupHandlers();
    const handler = socketHandlers.get("project:get-fork-settings");
    const callback = vi.fn();

    handler?.({}, callback);

    expect(callback).toHaveBeenCalledWith({
      forkMode: false,
      forkRepo: null,
      forkUpstreamPr: true,
    });
  });

  it("returns defaults when project does not exist for get-fork-settings", () => {
    mockDbGet.mockReturnValue(undefined);
    setupHandlers();
    const handler = socketHandlers.get("project:get-fork-settings");
    const callback = vi.fn();

    handler?.({ projectId: "nonexistent" }, callback);

    expect(callback).toHaveBeenCalledWith({
      forkMode: false,
      forkRepo: null,
      forkUpstreamPr: true,
    });
  });

  it("returns error when project does not exist for set-fork-upstream-pr", () => {
    mockDbGet.mockReturnValue(undefined);
    setupHandlers();
    const handler = socketHandlers.get("project:set-fork-upstream-pr");
    const callback = vi.fn();

    handler?.({ projectId: "nonexistent", enabled: true }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Project not found" });
  });

  it("rejects non-boolean enabled value for set-fork-upstream-pr", () => {
    setupHandlers();
    const handler = socketHandlers.get("project:set-fork-upstream-pr");
    const callback = vi.fn();

    handler?.({ projectId: "proj-1", enabled: "yes" }, callback);

    expect(callback).toHaveBeenCalledWith({ ok: false, error: "Invalid enabled value" });
    expect(mockSetConfig).not.toHaveBeenCalled();
  });
});
