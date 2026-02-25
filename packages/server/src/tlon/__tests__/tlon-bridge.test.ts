import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TlonBridge } from "../tlon-bridge.js";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface SendParams {
  fromAgentId: string | null;
  toAgentId: string | null;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

function createMockBus() {
  const broadcastHandlers: ((message: BusMessage) => void)[] = [];
  const sent: SendParams[] = [];

  const bus = {
    send: vi.fn((params: SendParams) => {
      sent.push(params);
      const message: BusMessage = {
        id: "test-msg-id",
        fromAgentId: params.fromAgentId,
        toAgentId: params.toAgentId,
        type: params.type as BusMessage["type"],
        content: params.content,
        metadata: params.metadata ?? {},
        conversationId: params.conversationId,
        timestamp: new Date().toISOString(),
      };
      return message;
    }),
    onBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      broadcastHandlers.push(handler);
    }),
    offBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      const idx = broadcastHandlers.indexOf(handler);
      if (idx >= 0) broadcastHandlers.splice(idx, 1);
    }),
    _broadcastHandlers: broadcastHandlers,
    _sent: sent,
  };

  return bus;
}

function createMockCoo() {
  return {
    startNewConversation: vi.fn(),
  };
}

function createMockIo() {
  return {
    emit: vi.fn(),
  };
}

const testConfig = {
  shipUrl: "http://localhost:8080",
  accessCode: "lidlut-tabwed-pillex-ridrup",
  shipName: "~zod",
};

function mockSuccessfulAuth() {
  mockFetch.mockResolvedValueOnce({
    status: 204,
    headers: new Headers({
      "set-cookie": "urbauth-~zod=abc123def456; Path=/; HttpOnly",
    }),
  });
}

function mockSuccessfulSubscribe() {
  // Mock the PUT subscribe action
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
  });
  // Mock the GET SSE stream - return an empty stream that doesn't block
  const mockReader = {
    read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
  };
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    body: { getReader: () => mockReader },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TlonBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: TlonBridge;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-tlon-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();

    bridge = new TlonBridge({
      bus: bus as any,
      coo: coo as any,
      io: io as any,
    });

    mockFetch.mockReset();
  });

  afterEach(async () => {
    await bridge.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Connection & Lifecycle
  // -------------------------------------------------------------------------

  describe("connection initialization", () => {
    it("authenticates with the Urbit ship on start", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/~/login",
        expect.objectContaining({
          method: "PUT",
          body: `password=${encodeURIComponent(testConfig.accessCode)}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
      );
    });

    it("emits connected status on start", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      expect(io.emit).toHaveBeenCalledWith("tlon:status", {
        status: "connected",
        shipName: "~zod",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("throws on authentication failure", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 403,
        headers: new Headers(),
      });

      await expect(bridge.start(testConfig)).rejects.toThrow(
        "Authentication failed: HTTP 403",
      );
    });

    it("throws when no cookie is returned", async () => {
      mockFetch.mockResolvedValueOnce({
        status: 204,
        headers: new Headers(),
      });

      await expect(bridge.start(testConfig)).rejects.toThrow(
        "Authentication failed: no session cookie returned",
      );
    });

    it("reports connected state after start", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      expect(bridge.isConnected()).toBe(false);
      await bridge.start(testConfig);
      expect(bridge.isConnected()).toBe(true);
    });
  });

  describe("cleanup on stop", () => {
    it("unsubscribes from bus broadcasts", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      await bridge.stop();

      expect(io.emit).toHaveBeenCalledWith("tlon:status", {
        status: "disconnected",
      });
    });

    it("reports disconnected state after stop", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      expect(bridge.isConnected()).toBe(true);
      await bridge.stop();
      expect(bridge.isConnected()).toBe(false);
    });

    it("can restart after stop", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      await bridge.stop();

      mockFetch.mockReset();
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);
      expect(bridge.isConnected()).toBe(true);
    });

    it("stop is safe to call when not started", async () => {
      await bridge.stop();
      expect(io.emit).toHaveBeenCalledWith("tlon:status", {
        status: "disconnected",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Content extraction
  // -------------------------------------------------------------------------

  describe("content extraction", () => {
    it("extracts plain string content", () => {
      expect(bridge.extractContent("hello world")).toBe("hello world");
    });

    it("extracts content from inline array with text objects", () => {
      const content = [
        { text: "Hello " },
        { text: "world" },
      ];
      expect(bridge.extractContent(content)).toBe("Hello world");
    });

    it("extracts content from mixed inline array", () => {
      const content = [
        "Hello ",
        { text: "world" },
        { mention: "~sampel" },
      ];
      expect(bridge.extractContent(content)).toBe("Hello world~sampel");
    });

    it("returns empty string for null/undefined content", () => {
      expect(bridge.extractContent(null)).toBe("");
      expect(bridge.extractContent(undefined)).toBe("");
    });

    it("returns empty string for non-string non-array content", () => {
      expect(bridge.extractContent(42)).toBe("");
      expect(bridge.extractContent({})).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → Tlon)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("ignores messages not from COO", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      const broadcastHandler = bus._broadcastHandlers[0]!;
      const fetchCountBefore = mockFetch.mock.calls.length;

      broadcastHandler({
        id: "msg-1",
        fromAgentId: "some-agent",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Not from COO",
        metadata: {},
        conversationId: "conv-1",
        timestamp: new Date().toISOString(),
      });

      // Wait for any async operations
      await new Promise((r) => setTimeout(r, 50));

      // No new fetch calls for sending
      expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
    });

    it("ignores COO messages addressed to another agent", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      const broadcastHandler = bus._broadcastHandlers[0]!;
      const fetchCountBefore = mockFetch.mock.calls.length;

      broadcastHandler({
        id: "msg-1",
        fromAgentId: "coo",
        toAgentId: "some-agent",
        type: MessageType.Chat,
        content: "For another agent",
        metadata: {},
        conversationId: "conv-1",
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
    });

    it("ignores COO messages for unknown conversations", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      const broadcastHandler = bus._broadcastHandlers[0]!;
      const fetchCountBefore = mockFetch.mock.calls.length;

      broadcastHandler({
        id: "msg-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Unknown conversation",
        metadata: {},
        conversationId: "unknown-conv-id",
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
    });

    it("sends messages to Tlon via poke", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      // Mock the poke response
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      await bridge.sendTlonMessage("chat/~zod/general", "Hello from COO!");

      // Find the poke call (last fetch call)
      const pokeCalls = mockFetch.mock.calls.filter((call: any) => {
        const body = call[1]?.body;
        if (typeof body === "string") {
          try {
            const parsed = JSON.parse(body);
            return Array.isArray(parsed) && parsed[0]?.action === "poke";
          } catch { return false; }
        }
        return false;
      });

      expect(pokeCalls.length).toBe(1);
      const pokeBody = JSON.parse(pokeCalls[0][1].body);
      expect(pokeBody[0].json["chat-action"].add.memo.content).toEqual([
        { text: "Hello from COO!" },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("handles failed poke gracefully", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();

      await bridge.start(testConfig);

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(
        bridge.sendTlonMessage("chat/~zod/general", "test"),
      ).rejects.toThrow("Failed to send message: HTTP 500");
    });

    it("stops cleanly even when not connected", async () => {
      // Should not throw
      await bridge.stop();
      expect(bridge.isConnected()).toBe(false);
    });

    it("stops previous connection on restart", async () => {
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();
      await bridge.start(testConfig);

      mockFetch.mockReset();
      mockSuccessfulAuth();
      mockSuccessfulSubscribe();
      await bridge.start(testConfig);

      // Should have emitted disconnected then connected
      const emitCalls = io.emit.mock.calls;
      const statusCalls = emitCalls.filter((c: any) => c[0] === "tlon:status");
      expect(statusCalls.some((c: any) => c[1].status === "disconnected")).toBe(true);
      expect(statusCalls[statusCalls.length - 1][1].status).toBe("connected");
    });
  });
});
