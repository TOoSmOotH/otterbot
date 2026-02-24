import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock whatsapp-web.js
// ---------------------------------------------------------------------------

class MockWhatsAppClient extends EventEmitter {
  initializeOptions: Record<string, unknown> = {};
  sentMessages: { chatId: string; content: string }[] = [];
  destroyed = false;

  constructor(options?: Record<string, unknown>) {
    super();
    this.initializeOptions = options ?? {};
  }

  async initialize() {
    // Simulate async ready event
    setTimeout(() => this.emit("ready"), 0);
  }

  async sendMessage(chatId: string, content: string) {
    this.sentMessages.push({ chatId, content });
  }

  async destroy() {
    this.destroyed = true;
  }
}

class MockLocalAuth {
  dataPath: string;
  constructor(opts?: { dataPath?: string }) {
    this.dataPath = opts?.dataPath ?? ".wwebjs_auth";
  }
}

vi.mock("whatsapp-web.js", () => ({
  default: { Client: MockWhatsAppClient, LocalAuth: MockLocalAuth },
  Client: MockWhatsAppClient,
  LocalAuth: MockLocalAuth,
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Import after mocking
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

  const testConfig = {
    dataPath: "/tmp/whatsapp-test",
    allowedNumbers: [] as string[],
  };

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-whatsapp-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

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

  describe("connection initialization", () => {
    it("emits ready status after initialization", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "connected",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start(testConfig);
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("emits qr status when QR is received", async () => {
      await bridge.start(testConfig);
      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("qr", "test-qr-code");

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "qr",
        qr: "test-qr-code",
      });
    });

    it("emits authenticated status", async () => {
      await bridge.start(testConfig);
      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("authenticated");

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "authenticated",
      });
    });

    it("emits auth_failure status on authentication error", async () => {
      await bridge.start(testConfig);
      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("auth_failure", "bad credentials");

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "auth_failure",
      });
    });
  });

  describe("cleanup on stop", () => {
    it("destroys the client", async () => {
      await bridge.start(testConfig);
      const client = (bridge as any).client as MockWhatsAppClient;
      await bridge.stop();
      expect(client.destroyed).toBe(true);
    });

    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "disconnected",
      });
    });

    it("nullifies the client after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect((bridge as any).client).toBeNull();
    });

    it("can restart after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      expect((bridge as any).client).not.toBeNull();
      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "connected",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (WhatsApp → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("routes incoming messages to COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello there",
        from: "1234567890@c.us",
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "hello there",
          metadata: expect.objectContaining({
            source: "whatsapp",
            whatsappPhone: "1234567890",
            whatsappChatId: "1234567890@c.us",
            whatsappIsGroup: false,
          }),
        }),
      );
    });

    it("ignores messages from self", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: true,
        type: "chat",
        body: "my own message",
        from: "1234567890@c.us",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores non-text messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "image",
        body: "",
        from: "1234567890@c.us",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores empty messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "   ",
        from: "1234567890@c.us",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("filters messages by allowed numbers when configured", async () => {
      await bridge.start({
        ...testConfig,
        allowedNumbers: ["1111111111"],
      });
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;

      // Blocked number
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello",
        from: "9999999999@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();

      // Allowed number
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello",
        from: "1111111111@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).toHaveBeenCalledOnce();
    });

    it("allows all numbers when allowedNumbers is empty", async () => {
      await bridge.start({ ...testConfig, allowedNumbers: [] });
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello from anyone",
        from: "5555555555@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).toHaveBeenCalledOnce();
    });

    it("creates a conversation for new messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hi",
        from: "1234567890@c.us",
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("WhatsApp: 1234567890"),
        }),
      );
    });

    it("reuses conversation for same chat", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;

      // First message
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "first",
        from: "1234567890@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));

      // Second message
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "second",
        from: "1234567890@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should only create one conversation
      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      // But send two messages
      expect(bus.send).toHaveBeenCalledTimes(2);
    });

    it("identifies group messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello group",
        from: "120363001234567890@g.us",
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            whatsappIsGroup: true,
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → WhatsApp)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to WhatsApp", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;

      // Simulate inbound message to establish a conversation
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hello",
        from: "1234567890@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));

      // Get the conversationId used
      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;
      expect(conversationId).toBeTruthy();

      // Simulate COO response via broadcast
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

      // Allow async sendMessage to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(client.sentMessages).toHaveLength(1);
      expect(client.sentMessages[0]).toEqual({
        chatId: "1234567890@c.us",
        content: "Hello from COO!",
      });
    });

    it("ignores messages not from COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
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

      expect(client.sentMessages).toHaveLength(0);
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
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

      expect(client.sentMessages).toHaveLength(0);
    });

    it("splits long messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;

      // Establish conversation
      client.emit("message", {
        fromMe: false,
        type: "chat",
        body: "hi",
        from: "1234567890@c.us",
      });
      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;

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

      // Allow async sendMessage calls to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(client.sentMessages.length).toBeGreaterThan(1);
      const totalContent = client.sentMessages.map((m) => m.content).join("");
      expect(totalContent).toBe(longMessage);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("emits disconnected status on WhatsApp disconnect event", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockWhatsAppClient;
      client.emit("disconnected", "session expired");

      expect(io.emit).toHaveBeenCalledWith("whatsapp:status", {
        status: "disconnected",
      });
    });

    it("handles stop gracefully when not started", async () => {
      // Should not throw
      await bridge.stop();
      expect((bridge as any).client).toBeNull();
    });

    it("stops existing client before restarting", async () => {
      await bridge.start(testConfig);
      const firstClient = (bridge as any).client as MockWhatsAppClient;

      await bridge.start(testConfig);
      expect(firstClient.destroyed).toBe(true);
      expect((bridge as any).client).not.toBe(firstClient);
    });
  });
});
