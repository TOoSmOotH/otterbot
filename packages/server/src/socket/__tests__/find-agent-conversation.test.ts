import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";

// Mock auth
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
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
    getConversationMessages: vi.fn((conversationId: string) => [{
      id: `msg-${conversationId}`,
      fromAgentId: null,
      toAgentId: "coo",
      type: "chat",
      content: `history:${conversationId}`,
      metadata: {},
      conversationId,
      timestamp: new Date().toISOString(),
    }]),
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

describe("ceo:find-agent-conversation socket handler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-find-conv-test-"));
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

  function setupHandler() {
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
    );

    return { mockBus, mockCoo };
  }

  it("returns the most recent specialist conversation for the active project", () => {
    const { mockBus, mockCoo } = setupHandler();
    const db = getDb();

    db.insert(schema.projects).values({
      id: "proj-1",
      name: "Project 1",
      description: "desc",
      status: "active",
      charter: "Project charter",
      charterStatus: "finalized",
      createdAt: new Date().toISOString(),
      githubIssueMonitor: false,
      rules: [],
    }).run();

    db.insert(schema.conversations).values([
      {
        id: "conv-old",
        title: "Old",
        projectId: "proj-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "conv-new",
        title: "New",
        projectId: "proj-1",
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "conv-other-project",
        title: "Other",
        projectId: "proj-2",
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]).run();

    db.insert(schema.messages).values([
      {
        id: "m-old",
        fromAgentId: "module-agent-dev",
        toAgentId: null,
        type: "report",
        content: "older specialist message",
        metadata: {},
        projectId: "proj-1",
        conversationId: "conv-old",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m-new",
        fromAgentId: "module-agent-dev",
        toAgentId: null,
        type: "report",
        content: "newest specialist message",
        metadata: {},
        projectId: "proj-1",
        conversationId: "conv-new",
        timestamp: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "m-ignore",
        fromAgentId: "module-agent-dev",
        toAgentId: null,
        type: "report",
        content: "ignored because different project",
        metadata: {},
        projectId: "proj-2",
        conversationId: "conv-other-project",
        timestamp: "2026-01-03T00:00:00.000Z",
      },
    ]).run();

    const handler = socketHandlers.get("ceo:find-agent-conversation");
    expect(handler).toBeDefined();

    const callback = vi.fn();
    handler!({ agentId: "module-agent-dev", projectId: "proj-1" }, callback);

    expect(mockBus.getConversationMessages).toHaveBeenCalledWith("conv-new");
    expect(mockCoo.loadConversation).toHaveBeenCalledWith(
      "conv-new",
      expect.arrayContaining([
        expect.objectContaining({ conversationId: "conv-new" }),
      ]),
      "proj-1",
      "Project charter",
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-new",
      }),
    );
  });

  it("maps null agentId to COO and only searches global conversations", () => {
    const { mockBus, mockCoo } = setupHandler();
    const db = getDb();

    db.insert(schema.conversations).values([
      {
        id: "conv-global",
        title: "Global",
        projectId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "conv-project",
        title: "Project",
        projectId: "proj-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]).run();

    db.insert(schema.messages).values([
      {
        id: "m-global",
        fromAgentId: "coo",
        toAgentId: null,
        type: "chat",
        content: "global coo message",
        metadata: {},
        projectId: null,
        conversationId: "conv-global",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m-project",
        fromAgentId: "coo",
        toAgentId: null,
        type: "chat",
        content: "project coo message",
        metadata: {},
        projectId: "proj-1",
        conversationId: "conv-project",
        timestamp: "2026-01-02T00:00:00.000Z",
      },
    ]).run();

    const handler = socketHandlers.get("ceo:find-agent-conversation");
    const callback = vi.fn();

    handler!({ agentId: null }, callback);

    expect(mockBus.getConversationMessages).toHaveBeenCalledWith("conv-global");
    expect(mockCoo.loadConversation).toHaveBeenCalledWith(
      "conv-global",
      expect.any(Array),
      null,
      null,
    );
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-global" }),
    );
  });

  it("returns null conversation and empty messages when no match exists", () => {
    setupHandler();
    const handler = socketHandlers.get("ceo:find-agent-conversation");
    const callback = vi.fn();

    handler!({ agentId: "module-agent-missing", projectId: "proj-x" }, callback);

    expect(callback).toHaveBeenCalledWith({ conversationId: null, messages: [] });
  });
});
