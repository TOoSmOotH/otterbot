import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../../db/index.js";

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

vi.mock("../../utils/git.js", () => ({
  initGitRepo: vi.fn(),
  createInitialCommit: vi.fn(),
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
    send: vi.fn((msg) => ({
      id: "msg-1",
      ...msg,
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

describe("ceo:message attachment metadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-ceo-message-test-"));
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

    return { mockBus };
  }

  it("includes attachments and projectId in bus message metadata", async () => {
    const { mockBus } = setupHandler();
    const handler = socketHandlers.get("ceo:message");
    expect(handler).toBeDefined();

    const attachments = [
      { id: "att-1", filename: "image.png", mimeType: "image/png", size: 42, url: "/uploads/att-1.png" },
    ];

    await handler!(
      {
        content: "See attachment",
        conversationId: "conv-1",
        projectId: "proj-1",
        attachments,
      },
      vi.fn(),
    );

    expect(mockBus.send).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          projectId: "proj-1",
          attachments,
        },
      }),
    );
  });

  it("sends empty metadata object when no projectId or attachments are provided", async () => {
    const { mockBus } = setupHandler();
    const handler = socketHandlers.get("ceo:message");
    expect(handler).toBeDefined();

    await handler!(
      {
        content: "Hello",
        conversationId: "conv-2",
      },
      vi.fn(),
    );

    expect(mockBus.send).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {},
      }),
    );
  });
});
