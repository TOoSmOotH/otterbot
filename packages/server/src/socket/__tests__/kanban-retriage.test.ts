import { describe, it, expect, vi, beforeEach } from "vitest";

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
    emit: vi.fn(),
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
        for (const s of sockets) handler(s);
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

function setupHandler(pipelineManager?: any) {
  const mockSocket = createMockSocket();
  const mockIo = createMockIo();
  mockIo._addSocket(mockSocket);

  setupSocketHandlers(
    mockIo as any,
    createMockBus() as any,
    createMockCoo() as any,
    createMockRegistry() as any,
    undefined,
    pipelineManager ? { pipelineManager } : undefined,
  );

  return { mockSocket };
}

describe("kanban:retriage socket handler", () => {
  beforeEach(() => {
    socketHandlers.clear();
  });

  it("acknowledges success when retriage returns an updated task", async () => {
    const retriage = vi.fn().mockResolvedValue({ id: "task-1" });
    setupHandler({ retriage });

    const handler = socketHandlers.get("kanban:retriage");
    expect(handler).toBeDefined();
    const callback = vi.fn();
    await handler!({ taskId: "task-1" }, callback);

    expect(retriage).toHaveBeenCalledWith("task-1");
    expect(callback).toHaveBeenCalledWith({ ok: true });
  });

  it("returns not-found style error when retriage returns null", async () => {
    const retriage = vi.fn().mockResolvedValue(null);
    setupHandler({ retriage });

    const callback = vi.fn();
    await socketHandlers.get("kanban:retriage")!({ taskId: "task-404" }, callback);

    expect(callback).toHaveBeenCalledWith({
      ok: false,
      error: "Task not found or not a GitHub issue task",
    });
  });

  it("returns unavailable error when pipeline manager is missing", async () => {
    setupHandler(undefined);

    const callback = vi.fn();
    await socketHandlers.get("kanban:retriage")!({ taskId: "task-1" }, callback);

    expect(callback).toHaveBeenCalledWith({
      ok: false,
      error: "Pipeline manager not available",
    });
  });

  it("surfaces thrown retriage errors in callback", async () => {
    const retriage = vi.fn().mockRejectedValue(new Error("retriage crashed"));
    setupHandler({ retriage });

    const callback = vi.fn();
    await socketHandlers.get("kanban:retriage")!({ taskId: "task-1" }, callback);

    expect(callback).toHaveBeenCalledWith({
      ok: false,
      error: "retriage crashed",
    });
  });
});
