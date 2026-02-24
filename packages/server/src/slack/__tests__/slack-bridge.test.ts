import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock @slack/bolt
// ---------------------------------------------------------------------------

class MockSlackApp extends EventEmitter {
  client = {
    conversations: {
      list: vi.fn().mockResolvedValue({
        channels: [
          { id: "C001", name: "general" },
          { id: "C002", name: "random" },
        ],
      }),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
  private handlers: Record<string, Function[]> = {};
  token: string = "";
  signingSecret: string = "";
  appToken: string = "";
  socketMode: boolean = false;
  started = false;

  constructor(opts: Record<string, unknown>) {
    super();
    this.token = opts.token as string;
    this.signingSecret = opts.signingSecret as string;
    this.appToken = opts.appToken as string;
    this.socketMode = opts.socketMode as boolean;
  }

  message(handler: Function) {
    if (!this.handlers.message) this.handlers.message = [];
    this.handlers.message.push(handler);
  }

  event(name: string, handler: Function) {
    if (!this.handlers[`event:${name}`]) this.handlers[`event:${name}`] = [];
    this.handlers[`event:${name}`].push(handler);
  }

  command(name: string, handler: Function) {
    if (!this.handlers[`command:${name}`]) this.handlers[`command:${name}`] = [];
    this.handlers[`command:${name}`].push(handler);
  }

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  // Test helpers to trigger handlers
  async _triggerMessage(message: Record<string, unknown>, say: Function) {
    for (const handler of this.handlers.message ?? []) {
      await handler({ message, say });
    }
  }

  async _triggerEvent(eventName: string, event: Record<string, unknown>, say?: Function) {
    for (const handler of this.handlers[`event:${eventName}`] ?? []) {
      await handler({ event, say });
    }
  }

  async _triggerCommand(commandName: string, command: Record<string, unknown>, ack: Function, say: Function) {
    for (const handler of this.handlers[`command:${commandName}`] ?? []) {
      await handler({ command, ack, say });
    }
  }
}

let mockAppInstance: MockSlackApp | null = null;

vi.mock("@slack/bolt", () => ({
  App: class extends MockSlackApp {
    constructor(opts: Record<string, unknown>) {
      super(opts);
      mockAppInstance = this;
    }
  },
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Import after mocking
const { SlackBridge } = await import("../slack-bridge.js");

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
  botToken: "xoxb-test-token",
  signingSecret: "test-signing-secret",
  appToken: "xapp-test-app-token",
};

describe("SlackBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof SlackBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-slack-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    mockAppInstance = null;

    bridge = new SlackBridge({
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
    it("starts the Slack app with socket mode", async () => {
      await bridge.start(testConfig);

      expect(mockAppInstance).not.toBeNull();
      expect(mockAppInstance!.started).toBe(true);
      expect(mockAppInstance!.socketMode).toBe(true);
    });

    it("emits connected status on start", async () => {
      await bridge.start(testConfig);

      expect(io.emit).toHaveBeenCalledWith("slack:status", {
        status: "connected",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start(testConfig);
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("passes the correct tokens to the Slack App", async () => {
      await bridge.start(testConfig);

      expect(mockAppInstance!.token).toBe("xoxb-test-token");
      expect(mockAppInstance!.signingSecret).toBe("test-signing-secret");
      expect(mockAppInstance!.appToken).toBe("xapp-test-app-token");
    });
  });

  describe("cleanup on stop", () => {
    it("stops the Slack app", async () => {
      await bridge.start(testConfig);
      const app = mockAppInstance!;
      await bridge.stop();

      expect(app.started).toBe(false);
    });

    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      expect(io.emit).toHaveBeenCalledWith("slack:status", {
        status: "disconnected",
      });
    });

    it("can restart after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      await bridge.start(testConfig);

      expect(mockAppInstance!.started).toBe(true);
      expect(io.emit).toHaveBeenCalledWith("slack:status", {
        status: "connected",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (Slack → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("routes DM messages to COO", async () => {
      await bridge.start(testConfig);

      // First pair the user
      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      // Disable require_mention for DMs test
      setConfig("slack:require_mention", "false");

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          user: "U123",
          channel: "D456",
          channel_type: "im",
          text: "hello there",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "hello there",
          metadata: expect.objectContaining({
            source: "slack",
            slackUserId: "U123",
            slackChannelId: "D456",
          }),
        }),
      );
    });

    it("ignores bot messages", async () => {
      await bridge.start(testConfig);

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          bot_id: "B123",
          user: "U123",
          channel: "D456",
          channel_type: "im",
          text: "bot message",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores message subtypes (edits, deletes)", async () => {
      await bridge.start(testConfig);

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          subtype: "message_changed",
          user: "U123",
          channel: "D456",
          channel_type: "im",
          text: "edited message",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("generates pairing code for unpaired users", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:require_mention", "false");

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          user: "U999",
          channel: "D456",
          channel_type: "im",
          text: "hello",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(say).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("approve this code"),
        }),
      );
      expect(io.emit).toHaveBeenCalledWith(
        "slack:pairing-request",
        expect.objectContaining({
          slackUserId: "U999",
        }),
      );
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("creates a conversation for new messages", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("slack:require_mention", "false");

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          user: "U123",
          channel: "D456",
          channel_type: "im",
          text: "hello",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Slack:"),
        }),
      );
    });

    it("reuses conversation for same user+channel", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("slack:require_mention", "false");

      const say = vi.fn();

      await mockAppInstance!._triggerMessage(
        { user: "U123", channel: "D456", channel_type: "im", text: "first", ts: "1" },
        say,
      );
      await mockAppInstance!._triggerMessage(
        { user: "U123", channel: "D456", channel_type: "im", text: "second", ts: "2" },
        say,
      );

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(bus.send).toHaveBeenCalledTimes(2);
    });

    it("ignores channel messages when requireMention is true (default)", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          user: "U123",
          channel: "C001",
          channel_type: "channel",
          text: "hello in channel",
          ts: "1234567890.123456",
        },
        say,
      );

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("respects allowed channels whitelist", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("slack:require_mention", "false");
      setConfig("slack:allowed_channels", JSON.stringify(["C001"]));

      const say = vi.fn();

      // Not in allowed channels
      await mockAppInstance!._triggerMessage(
        { user: "U123", channel: "C999", channel_type: "channel", text: "hello", ts: "1" },
        say,
      );
      expect(bus.send).not.toHaveBeenCalled();

      // In allowed channels
      await mockAppInstance!._triggerMessage(
        { user: "U123", channel: "C001", channel_type: "channel", text: "hello", ts: "2" },
        say,
      );
      expect(bus.send).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // App Mention Events
  // -------------------------------------------------------------------------

  describe("app_mention handling", () => {
    it("routes app_mention events to COO", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const say = vi.fn();
      await mockAppInstance!._triggerEvent("app_mention", {
        user: "U123",
        channel: "C001",
        text: "<@B123> what is the weather?",
        ts: "1234567890.123456",
      }, say);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "what is the weather?",
          metadata: expect.objectContaining({
            source: "slack",
            slackUserId: "U123",
          }),
        }),
      );
    });

    it("strips bot mention from app_mention text", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const say = vi.fn();
      await mockAppInstance!._triggerEvent("app_mention", {
        user: "U123",
        channel: "C001",
        text: "<@B456> hello bot",
        ts: "1234567890.123456",
      }, say);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "hello bot",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Slash Commands
  // -------------------------------------------------------------------------

  describe("slash command handling", () => {
    it("routes /otterbot command to COO", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const ack = vi.fn();
      const say = vi.fn();
      await mockAppInstance!._triggerCommand("/otterbot", {
        user_id: "U123",
        user_name: "alice",
        channel_id: "C001",
        text: "remind me to buy milk",
      }, ack, say);

      expect(ack).toHaveBeenCalled();
      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "remind me to buy milk",
          metadata: expect.objectContaining({
            source: "slack",
          }),
        }),
      );
    });

    it("shows usage when command has no text", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const ack = vi.fn();
      const say = vi.fn();
      await mockAppInstance!._triggerCommand("/otterbot", {
        user_id: "U123",
        user_name: "alice",
        channel_id: "C001",
        text: "",
      }, ack, say);

      expect(say).toHaveBeenCalledWith(expect.stringContaining("Usage"));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("generates pairing code for unpaired slash command user", async () => {
      await bridge.start(testConfig);

      const ack = vi.fn();
      const say = vi.fn();
      await mockAppInstance!._triggerCommand("/otterbot", {
        user_id: "U999",
        user_name: "stranger",
        channel_id: "C001",
        text: "hello",
      }, ack, say);

      expect(say).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("approve this code"),
        }),
      );
      expect(bus.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → Slack)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to Slack", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("slack:require_mention", "false");

      const say = vi.fn();
      await mockAppInstance!._triggerMessage(
        {
          user: "U123",
          channel: "D456",
          channel_type: "im",
          text: "hello",
          ts: "1234567890.123456",
        },
        say,
      );

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

      // Wait for async operation
      await new Promise((r) => setTimeout(r, 50));

      expect(mockAppInstance!.client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "D456",
          text: "Hello from COO!",
          thread_ts: "1234567890.123456",
        }),
      );
    });

    it("ignores messages not from COO", async () => {
      await bridge.start(testConfig);

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

      expect(mockAppInstance!.client.chat.postMessage).not.toHaveBeenCalled();
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start(testConfig);

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

      expect(mockAppInstance!.client.chat.postMessage).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableChannels
  // -------------------------------------------------------------------------

  describe("getAvailableChannels", () => {
    it("returns available channels from Slack API", async () => {
      await bridge.start(testConfig);
      const channels = await bridge.getAvailableChannels();

      expect(channels).toEqual([
        { id: "C001", name: "general" },
        { id: "C002", name: "random" },
      ]);
    });

    it("returns empty array when not started", async () => {
      const channels = await bridge.getAvailableChannels();
      expect(channels).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Reaction Events
  // -------------------------------------------------------------------------

  describe("reaction handling", () => {
    it("logs reactions from paired users", async () => {
      await bridge.start(testConfig);

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("slack:paired:U123", JSON.stringify({
        slackUserId: "U123",
        slackUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await mockAppInstance!._triggerEvent("reaction_added", {
        user: "U123",
        reaction: "thumbsup",
        item: { ts: "1234567890.123456" },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(":thumbsup:"),
      );

      consoleSpy.mockRestore();
    });

    it("ignores reactions from unpaired users", async () => {
      await bridge.start(testConfig);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await mockAppInstance!._triggerEvent("reaction_added", {
        user: "U999",
        reaction: "thumbsup",
        item: { ts: "1234567890.123456" },
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
