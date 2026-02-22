import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock irc-framework
// ---------------------------------------------------------------------------

class MockIrcClient extends EventEmitter {
  nick = "";
  connectOptions: Record<string, unknown> = {};
  joinedChannels: string[] = [];
  sentMessages: { target: string; message: string }[] = [];
  quitMessage: string | null = null;

  connect(options: Record<string, unknown>) {
    this.connectOptions = options;
    this.nick = options.nick as string;
    // Simulate async registered event
    setTimeout(() => this.emit("registered"), 0);
  }

  join(channel: string) {
    this.joinedChannels.push(channel);
    this.emit("join", { channel, nick: this.nick });
  }

  part(channel: string) {
    this.joinedChannels = this.joinedChannels.filter((c) => c !== channel);
    this.emit("part", { channel, nick: this.nick });
  }

  say(target: string, message: string) {
    this.sentMessages.push({ target, message });
  }

  quit(message?: string) {
    this.quitMessage = message ?? null;
  }
}

vi.mock("irc-framework", () => ({
  default: { Client: MockIrcClient },
  Client: MockIrcClient,
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

// Import after mocking
const { IrcBridge } = await import("../irc-bridge.js");

function createMockBus() {
  const broadcastHandlers: ((message: BusMessage) => void)[] = [];
  const sent: Parameters<typeof bus.send>[0][] = [];

  const bus = {
    send: vi.fn((params: Parameters<typeof bus.send>[0]) => {
      sent.push(params);
      const message: BusMessage = {
        id: "test-msg-id",
        fromAgentId: params.fromAgentId,
        toAgentId: params.toAgentId,
        type: params.type,
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

describe("IrcBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof IrcBridge>;

  const testConfig = {
    server: "irc.example.com",
    port: 6667,
    nickname: "otterbot",
    channels: ["#general", "#dev"],
  };

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-irc-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();

    bridge = new IrcBridge({
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
    it("connects with the provided config", async () => {
      await bridge.start(testConfig);
      // Wait for the async "registered" event
      await new Promise((r) => setTimeout(r, 50));

      expect(io.emit).toHaveBeenCalledWith("irc:status", {
        status: "connected",
        nickname: "otterbot",
      });
    });

    it("joins configured channels on connect", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      // Access the internal client to check joined channels
      const client = (bridge as any).client as MockIrcClient;
      expect(client.joinedChannels).toContain("#general");
      expect(client.joinedChannels).toContain("#dev");
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start(testConfig);
      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("passes TLS option when configured", async () => {
      await bridge.start({ ...testConfig, tls: true });
      const client = (bridge as any).client as MockIrcClient;
      expect(client.connectOptions.tls).toBe(true);
    });

    it("passes password when configured", async () => {
      await bridge.start({ ...testConfig, password: "secret" });
      const client = (bridge as any).client as MockIrcClient;
      expect(client.connectOptions.password).toBe("secret");
    });
  });

  describe("cleanup on stop", () => {
    it("quits the IRC client", async () => {
      await bridge.start(testConfig);
      const client = (bridge as any).client as MockIrcClient;
      await bridge.stop();
      expect(client.quitMessage).toBe("Shutting down");
    });

    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      expect(io.emit).toHaveBeenCalledWith("irc:status", {
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
      expect(io.emit).toHaveBeenCalledWith("irc:status", {
        status: "connected",
        nickname: "otterbot",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (IRC → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("routes channel messages with bot mention to COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: hello there",
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
            source: "irc",
            ircNick: "alice",
            ircChannel: "#general",
          }),
        }),
      );
    });

    it("ignores channel messages without bot mention", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "just talking normally",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("routes DMs directly to COO without requiring mention", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
      client.emit("privmsg", {
        nick: "alice",
        target: "otterbot",
        message: "hello via DM",
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "hello via DM",
          metadata: expect.objectContaining({
            source: "irc",
            ircIsDM: true,
          }),
        }),
      );
    });

    it("ignores messages from self", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
      client.emit("privmsg", {
        nick: "otterbot",
        target: "#general",
        message: "my own message",
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();
    });

    it("creates a conversation for new messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: hi",
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("IRC: alice"),
        }),
      );
    });

    it("reuses conversation for same nick+channel", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;

      // First message
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: first",
      });
      await new Promise((r) => setTimeout(r, 50));

      // Second message
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: second",
      });
      await new Promise((r) => setTimeout(r, 50));

      // Should only create one conversation
      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      // But send two messages
      expect(bus.send).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → IRC)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to IRC channel", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;

      // Simulate inbound message to establish a conversation
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: hello",
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

      expect(client.sentMessages).toHaveLength(1);
      expect(client.sentMessages[0]).toEqual({
        target: "#general",
        message: "Hello from COO!",
      });
    });

    it("ignores messages not from COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const client = (bridge as any).client as MockIrcClient;
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

      const client = (bridge as any).client as MockIrcClient;
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

      const client = (bridge as any).client as MockIrcClient;

      // Establish conversation
      client.emit("privmsg", {
        nick: "alice",
        target: "#general",
        message: "otterbot: hi",
      });
      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;

      const longMessage = "x".repeat(1000);
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

      expect(client.sentMessages.length).toBeGreaterThan(1);
      const totalContent = client.sentMessages.map((m) => m.message).join("");
      expect(totalContent).toBe(longMessage);
    });
  });

  // -------------------------------------------------------------------------
  // getJoinedChannels
  // -------------------------------------------------------------------------

  describe("getJoinedChannels", () => {
    it("returns configured channels", async () => {
      await bridge.start(testConfig);
      expect(bridge.getJoinedChannels()).toEqual(["#general", "#dev"]);
    });

    it("returns empty array when not started", () => {
      expect(bridge.getJoinedChannels()).toEqual([]);
    });
  });
});
