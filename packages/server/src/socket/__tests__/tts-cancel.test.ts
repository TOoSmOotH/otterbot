import { describe, it, expect, vi, beforeEach } from "vitest";

describe("cancel-tts socket handler (server-side)", () => {
  // Track socket event handlers
  type SocketHandler = (...args: any[]) => void;
  let socketHandlers: Map<string, SocketHandler>;

  function createMockIo() {
    return {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (socket: any) => void) => {
        if (event === "connection") {
          handler(mockSocket);
        }
      }),
    };
  }

  function createMockSocket() {
    return {
      on: vi.fn((event: string, handler: SocketHandler) => {
        socketHandlers.set(event, handler);
      }),
      emit: vi.fn(),
    };
  }

  function createMockBus() {
    return {
      onBroadcast: vi.fn(),
      send: vi.fn(() => ({
        id: "msg-1",
        fromAgentId: null,
        toAgentId: "coo",
        type: "text",
        content: "Hello",
        timestamp: new Date().toISOString(),
      })),
    };
  }

  function createMockCoo() {
    return {
      getCurrentConversationId: vi.fn(() => null),
    };
  }

  function createMockRegistry() {
    return {
      list: vi.fn(() => []),
      get: vi.fn(() => null),
    };
  }

  let mockSocket: any;
  let mockIo: any;
  let mockBus: any;
  let mockCoo: any;
  let mockRegistry: any;

  beforeEach(() => {
    socketHandlers = new Map<string, SocketHandler>();
    mockSocket = createMockSocket();
    mockIo = createMockIo();
    mockBus = createMockBus();
    mockCoo = createMockCoo();
    mockRegistry = createMockRegistry();

    // Clear module cache to reset ttsGeneration counter
    vi.resetModules();
  });

  async function setupHandlers() {
    const { setupSocketHandlers } = await import("../handlers.js");
    setupSocketHandlers(mockIo, mockBus, mockCoo, mockRegistry);
  }

  describe("ceo:cancel-tts client event", () => {
    it("invokes callback when provided", async () => {
      await setupHandlers();
      const handler = socketHandlers.get("ceo:cancel-tts");
      expect(handler).toBeDefined();

      const callback = vi.fn();
      await handler!(callback);

      expect(callback).toHaveBeenCalledWith({ ok: true });
    });

    it("works without callback (best-effort)", async () => {
      await setupHandlers();
      const handler = socketHandlers.get("ceo:cancel-tts");
      expect(handler).toBeDefined();

      await handler!();

      // Should complete without error
    });
  });
});
