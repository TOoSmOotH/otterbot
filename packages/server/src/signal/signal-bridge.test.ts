import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { migrateDb, resetDb } from "../db/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock auth - config store for testing
const configStore = new Map<string, string>();

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock COO
const mockCoo = {
  startNewConversation: vi.fn(),
} as any;

// Mock Socket.IO server
const mockIo = {
  emit: vi.fn(),
} as any;

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBus(): MessageBus {
  return new MessageBus();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SignalBridge", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-signal-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();

    // Reset mock states
    configStore.clear();
    vi.clearAllMocks();

    // Default: mock successful API responses
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
      text: async () => "[]",
    });
  });

  afterEach(async () => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Dynamic import to get the module after mocks are set
  async function createBridge() {
    const { SignalBridge } = await import("./signal-bridge.js");
    return new SignalBridge({ bus, coo: mockCoo, io: mockIo });
  }

  describe("connection initialization", () => {
    it("starts polling and emits connected status", async () => {
      const bridge = await createBridge();
      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/accounts",
        expect.objectContaining({}),
      );
      expect(mockIo.emit).toHaveBeenCalledWith("signal:status", {
        status: "connected",
        phoneNumber: "+15551234567",
      });

      await bridge.stop();
    });

    it("emits error status when API is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));
      const bridge = await createBridge();

      await expect(
        bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" }),
      ).rejects.toThrow("Connection refused");

      expect(mockIo.emit).toHaveBeenCalledWith("signal:status", { status: "error" });
    });

    it("emits disconnected status on stop", async () => {
      const bridge = await createBridge();
      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });
      await bridge.stop();

      expect(mockIo.emit).toHaveBeenCalledWith("signal:status", { status: "disconnected" });
    });

    it("stops previous bridge when starting a new one", async () => {
      const bridge = await createBridge();
      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });
      await bridge.start({ apiUrl: "http://localhost:9090", phoneNumber: "+15559876543" });

      // Should have emitted disconnected before re-connecting
      expect(mockIo.emit).toHaveBeenCalledWith("signal:status", { status: "disconnected" });

      await bridge.stop();
    });
  });

  describe("receiving messages", () => {
    it("routes a text message from a paired user to the bus", async () => {
      const bridge = await createBridge();

      // Set up fetch to return messages on poll
      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/receive/")) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => [
                {
                  sourceNumber: "+15559876543",
                  dataMessage: { message: "Hello Otterbot!" },
                },
              ],
            };
          }
          return { ok: true, json: async () => [] };
        }
        // accounts check
        return { ok: true, json: async () => [], text: async () => "[]" };
      });

      // Pair the user
      configStore.set(
        "signal:paired:+15559876543",
        JSON.stringify({ signalNumber: "+15559876543", pairedAt: new Date().toISOString() }),
      );

      const busSendSpy = vi.spyOn(bus, "send");

      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });

      // Wait for the first poll cycle
      await new Promise((r) => setTimeout(r, 3_000));

      expect(busSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "Hello Otterbot!",
          metadata: expect.objectContaining({
            source: "signal",
            signalNumber: "+15559876543",
          }),
        }),
      );

      await bridge.stop();
    });

    it("sends a pairing code to unpaired users", async () => {
      const bridge = await createBridge();

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string, opts?: any) => {
        if (typeof url === "string" && url.includes("/receive/")) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => [
                {
                  sourceNumber: "+15559999999",
                  dataMessage: { message: "Hello" },
                },
              ],
            };
          }
          return { ok: true, json: async () => [] };
        }
        if (typeof url === "string" && url.includes("/send/")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => [], text: async () => "[]" };
      });

      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });

      // Wait for the first poll cycle
      await new Promise((r) => setTimeout(r, 3_000));

      // Should have sent a pairing message
      const sendCalls = mockFetch.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/send/"),
      );
      expect(sendCalls.length).toBeGreaterThan(0);

      const body = JSON.parse(sendCalls[0][1].body);
      expect(body.recipients).toContain("+15559999999");
      expect(body.message).toContain("pair");

      expect(mockIo.emit).toHaveBeenCalledWith(
        "signal:pairing-request",
        expect.objectContaining({ signalNumber: "+15559999999" }),
      );

      await bridge.stop();
    });

    it("ignores messages from the bot itself", async () => {
      const bridge = await createBridge();

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/receive/")) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => [
                {
                  sourceNumber: "+15551234567", // same as bot number
                  dataMessage: { message: "Echo" },
                },
              ],
            };
          }
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => [], text: async () => "[]" };
      });

      const busSendSpy = vi.spyOn(bus, "send");

      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });
      await new Promise((r) => setTimeout(r, 3_000));

      expect(busSendSpy).not.toHaveBeenCalled();

      await bridge.stop();
    });

    it("ignores group messages", async () => {
      const bridge = await createBridge();

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === "string" && url.includes("/receive/")) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => [
                {
                  sourceNumber: "+15559876543",
                  dataMessage: {
                    message: "Group msg",
                    groupInfo: { groupId: "group123" },
                  },
                },
              ],
            };
          }
          return { ok: true, json: async () => [] };
        }
        return { ok: true, json: async () => [], text: async () => "[]" };
      });

      configStore.set(
        "signal:paired:+15559876543",
        JSON.stringify({ signalNumber: "+15559876543", pairedAt: new Date().toISOString() }),
      );

      const busSendSpy = vi.spyOn(bus, "send");

      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });
      await new Promise((r) => setTimeout(r, 3_000));

      expect(busSendSpy).not.toHaveBeenCalled();

      await bridge.stop();
    });
  });

  describe("sending messages", () => {
    it("sends COO response back via Signal", async () => {
      const bridge = await createBridge();

      let callCount = 0;
      mockFetch.mockImplementation(async (url: string, opts?: any) => {
        if (typeof url === "string" && url.includes("/receive/")) {
          callCount++;
          if (callCount === 1) {
            return {
              ok: true,
              json: async () => [
                {
                  sourceNumber: "+15559876543",
                  dataMessage: { message: "What is 2+2?" },
                },
              ],
            };
          }
          return { ok: true, json: async () => [] };
        }
        if (typeof url === "string" && url.includes("/send/")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => [], text: async () => "[]" };
      });

      configStore.set(
        "signal:paired:+15559876543",
        JSON.stringify({ signalNumber: "+15559876543", pairedAt: new Date().toISOString() }),
      );

      await bridge.start({ apiUrl: "http://localhost:8080", phoneNumber: "+15551234567" });

      // Wait for the poll to pick up the message
      await new Promise((r) => setTimeout(r, 3_000));

      // Get the conversationId from the COO mock
      const conversationId = mockCoo.startNewConversation.mock.calls[0]?.[0];
      expect(conversationId).toBeTruthy();

      mockFetch.mockClear();
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      // Simulate COO responding via broadcast
      bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "The answer is 4.",
        conversationId,
      });

      await new Promise((r) => setTimeout(r, 100));

      // Verify the reply was sent
      const sendCalls = mockFetch.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/send/"),
      );
      expect(sendCalls.length).toBeGreaterThan(0);

      const body = JSON.parse(sendCalls[0][1].body);
      expect(body.recipients).toContain("+15559876543");
      expect(body.message).toBe("The answer is 4.");

      await bridge.stop();
    });
  });
});
