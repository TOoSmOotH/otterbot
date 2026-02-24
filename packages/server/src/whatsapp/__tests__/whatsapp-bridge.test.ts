import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock @whiskeysockets/baileys
// ---------------------------------------------------------------------------

class MockWASocket extends EventEmitter {
  user = { id: "1234567890:0@s.whatsapp.net" };
  sentMessages: { jid: string; content: Record<string, unknown> }[] = [];
  ended = false;

  ev = {
    _handlers: new Map<string, ((...args: unknown[]) => void)[]>(),
    on(event: string, handler: (...args: unknown[]) => void) {
      const handlers = this._handlers.get(event) ?? [];
      handlers.push(handler);
      this._handlers.set(event, handlers);
    },
    off(event: string, handler: (...args: unknown[]) => void) {
      const handlers = this._handlers.get(event) ?? [];
      this._handlers.set(event, handlers.filter((h) => h !== handler));
    },
    emit(event: string, ...args: unknown[]) {
      const handlers = this._handlers.get(event) ?? [];
      for (const handler of handlers) {
        handler(...args);
      }
    },
  };

  async sendMessage(jid: string, content: Record<string, unknown>) {
    this.sentMessages.push({ jid, content });
    return { key: { id: "msg-" + this.sentMessages.length } };
  }

  end() {
    this.ended = true;
  }
}

let mockSocket: MockWASocket;

vi.mock("@whiskeysockets/baileys", () => {
  return {
    default: () => {
      mockSocket = new MockWASocket();
      return mockSocket;
    },
    useMultiFileAuthState: vi.fn(async () => ({
      state: { creds: {}, keys: {} },
      saveCreds: vi.fn(),
    })),
    DisconnectReason: {
      loggedOut: 401,
      connectionLost: 408,
      connectionClosed: 428,
      restartRequired: 515,
    },
  };
});

vi.mock("@hapi/boom", () => ({
  Boom: class Boom extends Error {
    output: { statusCode: number };
    constructor(message: string, options?: { statusCode: number }) {
      super(message);
      this.output = { statusCode: options?.statusCode ?? 500 };
    }
  },
}));

// Mock config store
const configStore = new Map<string, string>();

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const { WhatsAppBridge } = await import("../whatsapp-bridge.js");

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

describe("WhatsAppBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof WhatsAppBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-wa-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    configStore.clear();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();

    bridge = new WhatsAppBridge({
      bus: bus as any,
      coo: coo as any,
      io: io as any,
    });
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

  describe("connection lifecycle", () => {
    it("subscribes to bus broadcasts on start", async () => {
      await bridge.start(join(tmpDir, "auth"));
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("emits connected status when connection opens", async () => {
      await bridge.start(join(tmpDir, "auth"));

      // Simulate connection open
      mockSocket.ev.emit("connection.update", { connection: "open" });

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "connected",
        phoneNumber: "1234567890",
      });
    });

    it("emits disconnected status when logged out", async () => {
      const { Boom } = await import("@hapi/boom");
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: new Boom("Logged out", { statusCode: 401 }) },
      });

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "disconnected",
      });
    });

    it("emits error status on non-logout close", async () => {
      const { Boom } = await import("@hapi/boom");
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: new Boom("Connection lost", { statusCode: 408 }) },
      });

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "error",
      });
    });

    it("emits QR code to clients", async () => {
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("connection.update", {
        qr: "test-qr-data-string",
      });

      expect(io.emit).toHaveBeenCalledWith("whatsapp:qr", {
        qr: "test-qr-data-string",
      });
    });

    it("unsubscribes from bus on stop", async () => {
      await bridge.start(join(tmpDir, "auth"));
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status on stop", async () => {
      await bridge.start(join(tmpDir, "auth"));
      await bridge.stop();
      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "disconnected",
      });
    });

    it("nullifies the socket after stop", async () => {
      await bridge.start(join(tmpDir, "auth"));
      await bridge.stop();
      expect((bridge as any).socket).toBeNull();
    });

    it("can restart after stop", async () => {
      await bridge.start(join(tmpDir, "auth"));
      await bridge.stop();
      await bridge.start(join(tmpDir, "auth"));

      expect((bridge as any).socket).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // QR Code Pairing
  // -------------------------------------------------------------------------

  describe("QR code pairing", () => {
    it("emits QR codes as they arrive", async () => {
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("connection.update", { qr: "qr-code-1" });
      mockSocket.ev.emit("connection.update", { qr: "qr-code-2" });

      expect(io.emit).toHaveBeenCalledWith("whatsapp:qr", { qr: "qr-code-1" });
      expect(io.emit).toHaveBeenCalledWith("whatsapp:qr", { qr: "qr-code-2" });
    });

    it("stores phone number on connection open", async () => {
      await bridge.start(join(tmpDir, "auth"));
      mockSocket.ev.emit("connection.update", { connection: "open" });

      expect(configStore.get("whatsapp:phone_number")).toBe("1234567890");
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (WhatsApp → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("sends pairing code for unpaired users", async () => {
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "Hello" },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should send pairing code message
      expect(mockSocket.sentMessages).toHaveLength(1);
      expect(mockSocket.sentMessages[0]!.jid).toBe("5551234567@s.whatsapp.net");
      expect((mockSocket.sentMessages[0]!.content as any).text).toContain(
        "I don't recognize you yet",
      );

      // Should emit pairing request
      expect(io.emit).toHaveBeenCalledWith(
        "whatsapp:pairing-request",
        expect.objectContaining({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
        }),
      );
    });

    it("routes messages from paired users to COO", async () => {
      // Mark user as paired
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "Hello bot!" },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "Hello bot!",
          metadata: expect.objectContaining({
            source: "whatsapp",
            whatsappJid: "5551234567@s.whatsapp.net",
          }),
        }),
      );
    });

    it("ignores messages from self", async () => {
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: true },
            message: { conversation: "My own message" },
            pushName: "Self",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).not.toHaveBeenCalled();
      expect(mockSocket.sentMessages).toHaveLength(0);
    });

    it("ignores non-text messages", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { imageMessage: { caption: "photo" } },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores non-notify message types", async () => {
      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "append",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "Hello" },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
      expect(mockSocket.sentMessages).toHaveLength(0);
    });

    it("creates a conversation for new messages", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "hi" },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("WhatsApp: Alice"),
        }),
      );
    });

    it("reuses conversation for same JID", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      // First message
      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "first" },
            pushName: "Alice",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 50));

      // Second message
      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "second" },
            pushName: "Alice",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should only create one conversation
      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      // But send two messages
      expect(bus.send).toHaveBeenCalledTimes(2);
    });

    it("handles extendedTextMessage", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { extendedTextMessage: { text: "quoted reply text" } },
            pushName: "Alice",
          },
        ],
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "quoted reply text",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → WhatsApp)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to WhatsApp", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      // Simulate inbound message
      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "hello" },
            pushName: "Alice",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;
      expect(conversationId).toBeTruthy();

      // Simulate COO response
      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Hello from COO!",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));

      // Find the COO reply (skip the pairing code message if any)
      const cooReply = mockSocket.sentMessages.find(
        (m) => (m.content as any).text === "Hello from COO!",
      );
      expect(cooReply).toBeTruthy();
      expect(cooReply!.jid).toBe("5551234567@s.whatsapp.net");
    });

    it("ignores messages not from COO", async () => {
      await bridge.start(join(tmpDir, "auth"));

      const broadcastHandler = bus._broadcastHandlers[0]!;
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

      expect(mockSocket.sentMessages).toHaveLength(0);
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start(join(tmpDir, "auth"));

      const broadcastHandler = bus._broadcastHandlers[0]!;
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

      expect(mockSocket.sentMessages).toHaveLength(0);
    });

    it("splits long messages", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      // Establish conversation
      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "hi" },
            pushName: "Alice",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;

      // Send a very long message
      const longMessage = "x".repeat(10000);
      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: longMessage,
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should have split the message into multiple parts
      const replies = mockSocket.sentMessages.filter(
        (m) => (m.content as any).text !== undefined && !(m.content as any).text.includes("don't recognize"),
      );
      expect(replies.length).toBeGreaterThan(1);

      const totalContent = replies.map((m) => (m.content as any).text).join("");
      expect(totalContent).toBe(longMessage);
    });

    it("does not send fallback when no paired users exist", async () => {
      await bridge.start(join(tmpDir, "auth"));

      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Unsolicited message",
        metadata: {},
        conversationId: "unknown-conv-id",
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockSocket.sentMessages).toHaveLength(0);
    });

    it("sends to known jid for unsolicited message on existing conversation", async () => {
      configStore.set(
        "whatsapp:paired:5551234567@s.whatsapp.net",
        JSON.stringify({
          whatsappJid: "5551234567@s.whatsapp.net",
          whatsappName: "Alice",
          pairedAt: new Date().toISOString(),
        }),
      );

      await bridge.start(join(tmpDir, "auth"));

      // Establish a conversation first
      mockSocket.ev.emit("messages.upsert", {
        type: "notify",
        messages: [
          {
            key: { remoteJid: "5551234567@s.whatsapp.net", fromMe: false },
            message: { conversation: "hello" },
            pushName: "Alice",
          },
        ],
      });
      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;

      // Consume the pending response first
      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "First reply",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });
      await new Promise((r) => setTimeout(r, 50));

      // Now send an unsolicited message to the same conversation
      broadcastHandler({
        id: "resp-2",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Follow-up message",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });
      await new Promise((r) => setTimeout(r, 50));

      const followUp = mockSocket.sentMessages.find(
        (m) => (m.content as any).text === "Follow-up message",
      );
      expect(followUp).toBeTruthy();
      expect(followUp!.jid).toBe("5551234567@s.whatsapp.net");
    });
  });
});
