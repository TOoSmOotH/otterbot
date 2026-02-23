import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock node-telegram-bot-api
// ---------------------------------------------------------------------------

class MockTelegramBot extends EventEmitter {
  token: string;
  options: Record<string, unknown>;
  pollingActive = true;
  sentMessages: Array<{ chatId: number; text: string; options?: Record<string, unknown> }> = [];
  chatActions: Array<{ chatId: number; action: string }> = [];
  sentPhotos: Array<{ chatId: number; photo: unknown; options?: Record<string, unknown> }> = [];
  sentDocuments: Array<{ chatId: number; doc: unknown; options?: Record<string, unknown> }> = [];

  constructor(token: string, options?: Record<string, unknown>) {
    super();
    this.token = token;
    this.options = options ?? {};
  }

  async getMe() {
    return { id: 12345, is_bot: true, first_name: "OtterBot", username: "otterbot_test" };
  }

  async sendMessage(chatId: number, text: string, options?: Record<string, unknown>) {
    this.sentMessages.push({ chatId, text, options });
    return { message_id: Math.floor(Math.random() * 100000), chat: { id: chatId }, text };
  }

  async sendChatAction(chatId: number, action: string) {
    this.chatActions.push({ chatId, action });
  }

  async sendPhoto(chatId: number, photo: unknown, options?: Record<string, unknown>) {
    this.sentPhotos.push({ chatId, photo, options });
    return { message_id: Math.floor(Math.random() * 100000) };
  }

  async sendDocument(chatId: number, doc: unknown, options?: Record<string, unknown>) {
    this.sentDocuments.push({ chatId, doc, options });
    return { message_id: Math.floor(Math.random() * 100000) };
  }

  async stopPolling() {
    this.pollingActive = false;
  }

  // Test helper to simulate an incoming message
  simulateMessage(msg: Record<string, unknown>) {
    this.emit("message", msg);
  }
}

let mockBotInstance: MockTelegramBot | null = null;

vi.mock("node-telegram-bot-api", () => ({
  default: class extends MockTelegramBot {
    constructor(token: string, options?: Record<string, unknown>) {
      super(token, options);
      mockBotInstance = this;
    }
  },
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Import after mocking
const { TelegramBridge } = await import("../telegram-bridge.js");

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

describe("TelegramBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof TelegramBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-telegram-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    mockBotInstance = null;

    bridge = new TelegramBridge({
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
    it("starts the bot with polling", async () => {
      await bridge.start("test-token");

      expect(mockBotInstance).not.toBeNull();
      expect(mockBotInstance!.pollingActive).toBe(true);
    });

    it("emits connected status on start", async () => {
      await bridge.start("test-token");

      expect(io.emit).toHaveBeenCalledWith("telegram:status", {
        status: "connected",
        botUsername: "otterbot_test",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start("test-token");
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });
  });

  describe("cleanup on stop", () => {
    it("stops bot polling", async () => {
      await bridge.start("test-token");
      const bot = mockBotInstance!;
      await bridge.stop();

      expect(bot.pollingActive).toBe(false);
    });

    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start("test-token");
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start("test-token");
      await bridge.stop();

      expect(io.emit).toHaveBeenCalledWith("telegram:status", {
        status: "disconnected",
      });
    });

    it("can restart after stop", async () => {
      await bridge.start("test-token");
      await bridge.stop();
      await bridge.start("test-token");

      expect(mockBotInstance!.pollingActive).toBe(true);
      expect(io.emit).toHaveBeenCalledWith("telegram:status", {
        status: "connected",
        botUsername: "otterbot_test",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (Telegram → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("routes messages from paired users to COO", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "hello there",
        date: Math.floor(Date.now() / 1000),
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "hello there",
          metadata: expect.objectContaining({
            source: "telegram",
            telegramUserId: "111",
            telegramChatId: "222",
          }),
        }),
      );
    });

    it("ignores messages from bots", async () => {
      await bridge.start("test-token");

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: true, first_name: "BotUser" },
        chat: { id: 222 },
        text: "bot message",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores messages without text", async () => {
      await bridge.start("test-token");

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice" },
        chat: { id: 222 },
        date: Math.floor(Date.now() / 1000),
        // no text field - sticker or media only
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("generates pairing code for unpaired users", async () => {
      await bridge.start("test-token");

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 999, is_bot: false, first_name: "Stranger", username: "stranger" },
        chat: { id: 222 },
        text: "hello",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockBotInstance!.sentMessages).toHaveLength(1);
      expect(mockBotInstance!.sentMessages[0]!.text).toContain("approve this code");
      expect(io.emit).toHaveBeenCalledWith(
        "telegram:pairing-request",
        expect.objectContaining({
          telegramUserId: "999",
        }),
      );
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("creates a conversation for new messages", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "hello",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Telegram:"),
        }),
      );
    });

    it("reuses conversation for same user+chat", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "first",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      mockBotInstance!.simulateMessage({
        message_id: 2,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "second",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(bus.send).toHaveBeenCalledTimes(2);
    });

    it("handles /start command with welcome message", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "/start",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockBotInstance!.sentMessages).toHaveLength(1);
      expect(mockBotInstance!.sentMessages[0]!.text).toContain("Otterbot");
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("strips command prefix and forwards arguments", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "/ask what is the weather?",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "what is the weather?",
        }),
      );
    });

    it("sends typing indicator on message receipt", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 1,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "hello",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockBotInstance!.chatActions).toContainEqual({
        chatId: 222,
        action: "typing",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → Telegram)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to Telegram", async () => {
      await bridge.start("test-token");

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("telegram:paired:111", JSON.stringify({
        telegramUserId: "111",
        telegramUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      mockBotInstance!.simulateMessage({
        message_id: 42,
        from: { id: 111, is_bot: false, first_name: "Alice", username: "alice" },
        chat: { id: 222 },
        text: "hello",
        date: Math.floor(Date.now() / 1000),
      });

      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;
      expect(conversationId).toBeTruthy();

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

      const reply = mockBotInstance!.sentMessages.find((m) => m.text === "Hello from COO!");
      expect(reply).toBeDefined();
      expect(reply!.chatId).toBe(222);
      expect(reply!.options).toEqual(
        expect.objectContaining({ reply_to_message_id: 42 }),
      );
    });

    it("ignores messages not from COO", async () => {
      await bridge.start("test-token");

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

      await new Promise((r) => setTimeout(r, 50));

      const reply = mockBotInstance!.sentMessages.find((m) => m.text === "Not from COO");
      expect(reply).toBeUndefined();
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start("test-token");

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

      await new Promise((r) => setTimeout(r, 50));

      const reply = mockBotInstance!.sentMessages.find((m) => m.text === "For another agent");
      expect(reply).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Media & Inline Keyboards
  // -------------------------------------------------------------------------

  describe("media sending", () => {
    it("can send photos", async () => {
      await bridge.start("test-token");

      await bridge.sendPhoto(222, "https://example.com/photo.jpg", "A photo");

      expect(mockBotInstance!.sentPhotos).toHaveLength(1);
      expect(mockBotInstance!.sentPhotos[0]).toEqual({
        chatId: 222,
        photo: "https://example.com/photo.jpg",
        options: { caption: "A photo" },
      });
    });

    it("can send documents", async () => {
      await bridge.start("test-token");

      await bridge.sendDocument(222, "https://example.com/doc.pdf", "A document");

      expect(mockBotInstance!.sentDocuments).toHaveLength(1);
      expect(mockBotInstance!.sentDocuments[0]).toEqual({
        chatId: 222,
        doc: "https://example.com/doc.pdf",
        options: { caption: "A document" },
      });
    });

    it("can send inline keyboards", async () => {
      await bridge.start("test-token");

      const keyboard = [[
        { text: "Yes", callback_data: "yes" },
        { text: "No", callback_data: "no" },
      ]];

      await bridge.sendMessageWithKeyboard(222, "Choose:", keyboard);

      const msg = mockBotInstance!.sentMessages.find((m) => m.text === "Choose:");
      expect(msg).toBeDefined();
      expect(msg!.options).toEqual({
        reply_markup: { inline_keyboard: keyboard },
      });
    });
  });
});
