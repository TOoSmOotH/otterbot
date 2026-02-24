import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "events";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];

  constructor(_url: string) {
    super();
    // Simulate async open
    setTimeout(() => this.emit("open"), 0);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit("close");
  }

  removeAllListeners() {
    super.removeAllListeners();
    return this;
  }

  // Test helper: simulate incoming message
  _receive(data: Record<string, unknown>) {
    this.emit("message", JSON.stringify(data));
  }
}

let mockWsInstance: MockWebSocket | null = null;

vi.mock("ws", () => ({
  default: class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWsInstance = this;
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock fetch (global)
// ---------------------------------------------------------------------------

const mockFetchResponses = new Map<string, { ok: boolean; status: number; body: unknown }>();

function setFetchResponse(urlPattern: string, response: { ok?: boolean; status?: number; body: unknown }) {
  mockFetchResponses.set(urlPattern, {
    ok: response.ok ?? true,
    status: response.status ?? 200,
    body: response.body,
  });
}

const originalFetch = globalThis.fetch;

globalThis.fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  for (const [pattern, response] of mockFetchResponses) {
    if (url.includes(pattern)) {
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.body,
        text: async () => JSON.stringify(response.body),
      } as Response;
    }
  }

  return { ok: false, status: 404, json: async () => ({}), text: async () => "Not found" } as Response;
}) as typeof fetch;

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const { MattermostBridge } = await import("../mattermost-bridge.js");

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
  serverUrl: "https://mm.example.com",
  token: "test-bot-token",
};

describe("MattermostBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof MattermostBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-mattermost-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    mockWsInstance = null;
    mockFetchResponses.clear();

    // Default: /users/me returns the bot user
    setFetchResponse("/api/v4/users/me", {
      body: { id: "bot-user-id", username: "otterbot" },
    });

    bridge = new MattermostBridge({
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
    mockFetchResponses.clear();
  });

  // -------------------------------------------------------------------------
  // Connection & Lifecycle
  // -------------------------------------------------------------------------

  describe("connection initialization", () => {
    it("authenticates and opens WebSocket", async () => {
      await bridge.start(testConfig);

      // Wait for WS open event
      await new Promise((r) => setTimeout(r, 50));

      expect(mockWsInstance).not.toBeNull();
      // Should have sent auth challenge
      expect(mockWsInstance!.sentMessages.length).toBeGreaterThanOrEqual(1);
      const authMsg = JSON.parse(mockWsInstance!.sentMessages[0]!);
      expect(authMsg.action).toBe("authentication_challenge");
      expect(authMsg.data.token).toBe("test-bot-token");
    });

    it("emits connected status on WebSocket open", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      expect(io.emit).toHaveBeenCalledWith("mattermost:status", {
        status: "connected",
        botUsername: "otterbot",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("throws on auth failure", async () => {
      setFetchResponse("/api/v4/users/me", {
        ok: false,
        status: 401,
        body: { message: "Invalid token" },
      });

      await expect(bridge.start(testConfig)).rejects.toThrow("Mattermost auth failed");
    });
  });

  describe("cleanup on stop", () => {
    it("closes WebSocket", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const ws = mockWsInstance!;
      await bridge.stop();

      expect(ws.readyState).toBe(3); // CLOSED
    });

    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));
      await bridge.stop();

      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));
      await bridge.stop();

      expect(io.emit).toHaveBeenCalledWith("mattermost:status", {
        status: "disconnected",
      });
    });

    it("can restart after stop", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));
      await bridge.stop();

      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockWsInstance).not.toBeNull();
      expect(io.emit).toHaveBeenCalledWith("mattermost:status", {
        status: "connected",
        botUsername: "otterbot",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound Messages (Mattermost → COO)
  // -------------------------------------------------------------------------

  describe("message handling", () => {
    it("routes DM messages to COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      // Pair the user
      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:require_mention", "false");

      // Mock user lookup
      setFetchResponse("/api/v4/users/user123", {
        body: { username: "alice" },
      });
      // Mock post creation (for any replies)
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "dm-channel",
            message: "hello there",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "hello there",
          metadata: expect.objectContaining({
            source: "mattermost",
            mattermostUserId: "user123",
            mattermostChannelId: "dm-channel",
          }),
        }),
      );
    });

    it("ignores bot's own messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "bot-user-id",
            channel_id: "ch1",
            message: "bot message",
            root_id: "",
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores messages from other bots", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "other-bot",
            channel_id: "ch1",
            message: "another bot",
            root_id: "",
            props: { from_bot: "true" },
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("generates pairing code for unpaired users", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:require_mention", "false");

      // Mock user lookup and post creation
      setFetchResponse("/api/v4/users/unknown-user", {
        body: { username: "stranger" },
      });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "unknown-user",
            channel_id: "dm-channel",
            message: "hello",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should have posted a pairing code reply
      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCalls = fetchCalls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/v4/posts") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(postCalls.length).toBeGreaterThanOrEqual(1);

      expect(io.emit).toHaveBeenCalledWith(
        "mattermost:pairing-request",
        expect.objectContaining({
          mattermostUserId: "unknown-user",
        }),
      );

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("creates a conversation for new messages", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:require_mention", "false");

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "dm-channel",
            message: "hello",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Mattermost:"),
        }),
      );
    });

    it("reuses conversation for same user+channel", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:require_mention", "false");

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "dm-channel",
            message: "first",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post2",
            user_id: "user123",
            channel_id: "dm-channel",
            message: "second",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(bus.send).toHaveBeenCalledTimes(2);
    });

    it("ignores channel messages when requireMention is true (default)", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "ch1",
            message: "hello in channel",
            root_id: "",
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("responds to @mention in channels", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:bot_username", "otterbot");

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "ch1",
            message: "@otterbot what is the weather?",
            root_id: "",
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "what is the weather?",
        }),
      );
    });

    it("respects allowed channels whitelist", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:require_mention", "false");
      setConfig("mattermost:allowed_channels", JSON.stringify(["ch-allowed"]));

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      // Not in allowed channels
      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "ch-blocked",
            message: "hello",
            root_id: "",
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).not.toHaveBeenCalled();

      // In allowed channels
      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post2",
            user_id: "user123",
            channel_id: "ch-allowed",
            message: "hello",
            root_id: "",
          }),
          channel_type: "O",
        },
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(bus.send).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → Mattermost)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("sends COO responses back to Mattermost", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:paired:user123", JSON.stringify({
        mattermostUserId: "user123",
        mattermostUsername: "alice",
        pairedAt: new Date().toISOString(),
      }));
      setConfig("mattermost:require_mention", "false");

      setFetchResponse("/api/v4/users/user123", { body: { username: "alice" } });
      setFetchResponse("/api/v4/posts", { body: { id: "post-resp" } });

      // Trigger an inbound message first
      mockWsInstance!._receive({
        event: "posted",
        data: {
          post: JSON.stringify({
            id: "post1",
            user_id: "user123",
            channel_id: "dm-channel",
            message: "hello",
            root_id: "",
          }),
          channel_type: "D",
        },
      });

      await new Promise((r) => setTimeout(r, 50));

      const conversationId = bus.send.mock.calls[0]?.[0]?.conversationId;
      expect(conversationId).toBeTruthy();

      // Reset fetch mock call tracking
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
      setFetchResponse("/api/v4/posts", { body: { id: "reply-post" } });

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

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCalls = fetchCalls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/v4/posts") && (c[1] as RequestInit)?.method === "POST",
      );
      expect(postCalls.length).toBeGreaterThanOrEqual(1);

      const postBody = JSON.parse((postCalls[0]![1] as RequestInit).body as string);
      expect(postBody.channel_id).toBe("dm-channel");
      expect(postBody.message).toBe("Hello from COO!");
      expect(postBody.root_id).toBe("post1"); // threaded reply
    });

    it("ignores messages not from COO", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

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

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCalls = fetchCalls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/v4/posts"),
      );
      expect(postCalls.length).toBe(0);
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

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

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCalls = fetchCalls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/api/v4/posts"),
      );
      expect(postCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableChannels
  // -------------------------------------------------------------------------

  describe("getAvailableChannels", () => {
    it("returns empty array when not started", async () => {
      const channels = await bridge.getAvailableChannels();
      expect(channels).toEqual([]);
    });

    it("returns empty array when no default team configured", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const channels = await bridge.getAvailableChannels();
      expect(channels).toEqual([]);
    });

    it("returns available channels for configured team", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      const { setConfig } = await import("../../auth/auth.js");
      setConfig("mattermost:default_team", "myteam");

      setFetchResponse("/api/v4/teams/name/myteam", {
        body: { id: "team-id", display_name: "My Team" },
      });
      setFetchResponse("/teams/team-id/channels", {
        body: [
          { id: "ch1", name: "town-square", display_name: "Town Square", type: "O" },
          { id: "ch2", name: "off-topic", display_name: "Off-Topic", type: "O" },
          { id: "dm1", name: "dm-channel", display_name: "DM", type: "D" },
        ],
      });

      const channels = await bridge.getAvailableChannels();
      expect(channels).toEqual([
        { id: "ch1", name: "town-square", displayName: "Town Square", teamName: "My Team" },
        { id: "ch2", name: "off-topic", displayName: "Off-Topic", teamName: "My Team" },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Error cases
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("emits error status on WebSocket error", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      mockWsInstance!.emit("error", new Error("connection failed"));

      expect(io.emit).toHaveBeenCalledWith("mattermost:status", {
        status: "error",
      });
    });

    it("emits disconnected status on WebSocket close", async () => {
      await bridge.start(testConfig);
      await new Promise((r) => setTimeout(r, 50));

      // Clear previous emit calls
      io.emit.mockClear();

      mockWsInstance!.emit("close");

      expect(io.emit).toHaveBeenCalledWith("mattermost:status", {
        status: "disconnected",
      });
    });
  });
});
