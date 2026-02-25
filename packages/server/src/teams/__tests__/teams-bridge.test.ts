import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { migrateDb, resetDb } from "../../db/index.js";

// ---------------------------------------------------------------------------
// Mock botbuilder SDK
// ---------------------------------------------------------------------------

const mockContinueConversationAsync = vi.fn().mockResolvedValue(undefined);
const mockOnTurnErrorSetter = vi.fn();

let capturedOnTurnError: ((ctx: unknown, err: Error) => Promise<void>) | null =
  null;

class MockCloudAdapter {
  private _onTurnError:
    | ((ctx: unknown, err: Error) => Promise<void>)
    | null = null;

  get onTurnError() {
    return this._onTurnError;
  }
  set onTurnError(fn: ((ctx: unknown, err: Error) => Promise<void>) | null) {
    this._onTurnError = fn;
    capturedOnTurnError = fn;
    mockOnTurnErrorSetter(fn);
  }

  continueConversationAsync = mockContinueConversationAsync;
}

const mockConfigBotFrameworkAuth = vi.fn();

vi.mock("botbuilder", () => ({
  ConfigurationBotFrameworkAuthentication: class {
    constructor(config: Record<string, unknown>) {
      mockConfigBotFrameworkAuth(config);
    }
  },
  CloudAdapter: MockCloudAdapter,
  ActivityTypes: { Message: "message" },
  TurnContext: {
    getConversationReference: vi.fn((activity: unknown) => ({
      _type: "conversationReference",
      activity,
    })),
  },
  MessageFactory: {
    text: vi.fn((text: string) => ({ type: "message", text })),
  },
}));

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const { TeamsBridge } = await import("../teams-bridge.js");
import { setConfig } from "../../auth/auth.js";

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

function makeTeamsContext(overrides: Record<string, unknown> = {}) {
  return {
    activity: {
      type: "message",
      text: "hello",
      from: { id: "user1", name: "Alice" },
      channelId: "msteams",
      ...overrides,
    },
    sendActivity: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TeamsBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof TeamsBridge>;

  const testConfig = {
    appId: "test-app-id",
    appPassword: "test-app-password",
  };

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-teams-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();

    bridge = new TeamsBridge({
      bus: bus as any,
      coo: coo as any,
      io: io as any,
    });

    // Pair default test users
    const now = new Date().toISOString();
    setConfig("teams:paired:user1", JSON.stringify({
      teamsUserId: "user1", teamsUsername: "Alice", pairedAt: now,
    }));
    setConfig("teams:paired:user2", JSON.stringify({
      teamsUserId: "user2", teamsUsername: "Bob", pairedAt: now,
    }));
    setConfig("teams:paired:user-abc", JSON.stringify({
      teamsUserId: "user-abc", teamsUsername: "Bob", pairedAt: now,
    }));
    setConfig("teams:paired:user-xyz", JSON.stringify({
      teamsUserId: "user-xyz", teamsUsername: "user-xyz", pairedAt: now,
    }));
    setConfig("teams:paired:unknown", JSON.stringify({
      teamsUserId: "unknown", teamsUsername: "unknown", pairedAt: now,
    }));

    mockContinueConversationAsync.mockReset();
    mockContinueConversationAsync.mockImplementation(
      async (_botAppId: string, _ref: unknown, callback: (ctx: unknown) => Promise<void>) => {
        const fakeCtx = { sendActivity: vi.fn().mockResolvedValue(undefined) };
        await callback(fakeCtx);
      },
    );
    mockConfigBotFrameworkAuth.mockReset();
    mockOnTurnErrorSetter.mockReset();
    capturedOnTurnError = null;
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
    it("starts the bridge and emits connected status", async () => {
      await bridge.start(testConfig);

      expect(io.emit).toHaveBeenCalledWith("teams:status", {
        status: "connected",
      });
    });

    it("configures Bot Framework authentication with app credentials", async () => {
      await bridge.start(testConfig);

      expect(mockConfigBotFrameworkAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          MicrosoftAppId: "test-app-id",
          MicrosoftAppPassword: "test-app-password",
        }),
      );
    });

    it("uses MultiTenant app type when no tenantId is provided", async () => {
      await bridge.start(testConfig);

      expect(mockConfigBotFrameworkAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          MicrosoftAppType: "MultiTenant",
        }),
      );
    });

    it("subscribes to bus broadcasts on start", async () => {
      await bridge.start(testConfig);

      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("sets up onTurnError handler", async () => {
      await bridge.start(testConfig);

      expect(capturedOnTurnError).toBeTypeOf("function");
    });

    it("emits error status on turn error", async () => {
      await bridge.start(testConfig);

      await capturedOnTurnError!({}, new Error("test error"));

      expect(io.emit).toHaveBeenCalledWith("teams:status", {
        status: "error",
      });
    });

    it("exposes the adapter via getAdapter()", async () => {
      await bridge.start(testConfig);

      const adapter = bridge.getAdapter();
      expect(adapter).toBeInstanceOf(MockCloudAdapter);
    });

    it("returns null adapter when not started", () => {
      expect(bridge.getAdapter()).toBeNull();
    });

    it("stops cleanly before restarting", async () => {
      await bridge.start(testConfig);
      // Start again — should call stop first
      await bridge.start(testConfig);

      // Should have called offBroadcast once for the first stop
      expect(bus.offBroadcast).toHaveBeenCalledOnce();
      // And onBroadcast twice (once per start)
      expect(bus.onBroadcast).toHaveBeenCalledTimes(2);
    });
  });

  describe("cleanup on stop", () => {
    it("unsubscribes from bus broadcasts", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      expect(bus.offBroadcast).toHaveBeenCalledOnce();
    });

    it("emits disconnected status", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      expect(io.emit).toHaveBeenCalledWith("teams:status", {
        status: "disconnected",
      });
    });

    it("nullifies the adapter", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      expect(bridge.getAdapter()).toBeNull();
    });

    it("clears pending responses", async () => {
      await bridge.start(testConfig);

      // Create a pending response via inbound message
      const ctx = makeTeamsContext();
      await bridge.handleTurn(ctx);

      await bridge.stop();
      // Verify adapter is null (pending responses cleared internally)
      expect(bridge.getAdapter()).toBeNull();
    });

    it("can restart after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();
      await bridge.start(testConfig);

      expect(bridge.getAdapter()).not.toBeNull();
      expect(io.emit).toHaveBeenCalledWith("teams:status", {
        status: "connected",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Inbound: Teams → COO
  // -------------------------------------------------------------------------

  describe("inbound message routing", () => {
    it("routes text messages to COO via bus", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello bot" });
      await bridge.handleTurn(ctx);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          fromAgentId: null,
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "hello bot",
          metadata: expect.objectContaining({
            source: "teams",
            teamsUserId: "user1",
            teamsChannelId: "msteams",
          }),
        }),
      );
    });

    it("trims whitespace from message text", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "  hello  " });
      await bridge.handleTurn(ctx);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "hello",
        }),
      );
    });

    it("ignores non-message activities", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext();
      ctx.activity.type = "conversationUpdate";
      await bridge.handleTurn(ctx);

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores empty messages", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "" });
      await bridge.handleTurn(ctx);

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores whitespace-only messages", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "   " });
      await bridge.handleTurn(ctx);

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("ignores messages with undefined text", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: undefined });
      await bridge.handleTurn(ctx);

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("does nothing when bb module is not loaded", async () => {
      // Don't start the bridge — bb is null
      const ctx = makeTeamsContext();
      await bridge.handleTurn(ctx);

      expect(bus.send).not.toHaveBeenCalled();
    });

    it("uses from.id as userId and defaults channelId", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({
        from: { id: "user-abc", name: "Bob" },
        channelId: "custom-channel",
      });
      await bridge.handleTurn(ctx);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            teamsUserId: "user-abc",
            teamsChannelId: "custom-channel",
          }),
        }),
      );
    });

    it("defaults userId to 'unknown' when from.id is missing", async () => {
      await bridge.start(testConfig);

      const ctx = {
        activity: {
          type: "message",
          text: "hi",
          from: undefined,
          channelId: "msteams",
        },
      };
      await bridge.handleTurn(ctx);

      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            teamsUserId: "unknown",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  describe("pairing", () => {
    it("sends pairing code to unpaired users", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({
        text: "hello",
        from: { id: "stranger", name: "Stranger" },
      });
      await bridge.handleTurn(ctx);

      // Should NOT route to COO
      expect(bus.send).not.toHaveBeenCalled();
      // Should send pairing message
      expect(ctx.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining("approve this code"),
      );
      // Should emit pairing request
      expect(io.emit).toHaveBeenCalledWith(
        "teams:pairing-request",
        expect.objectContaining({
          teamsUserId: "stranger",
          teamsUsername: "Stranger",
        }),
      );
    });

    it("routes messages from paired users to COO", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      expect(bus.send).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // Conversation creation
  // -------------------------------------------------------------------------

  describe("conversation creation", () => {
    it("creates a new conversation for first message from a user", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "first message" });
      await bridge.handleTurn(ctx);

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Teams: Alice"),
        }),
      );
    });

    it("includes message preview in conversation title", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "what is the weather today" });
      await bridge.handleTurn(ctx);

      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("what is the weather today"),
        }),
      );
    });

    it("truncates long messages in conversation title to 60 chars", async () => {
      await bridge.start(testConfig);

      const longText = "x".repeat(100);
      const ctx = makeTeamsContext({ text: longText });
      await bridge.handleTurn(ctx);

      const createCall = io.emit.mock.calls.find(
        (c: unknown[]) => c[0] === "conversation:created",
      );
      expect(createCall).toBeTruthy();
      const title = (createCall![1] as { title: string }).title;
      // Title format: "Teams: Alice — " + truncated text
      expect(title.length).toBeLessThanOrEqual("Teams: Alice — ".length + 60);
    });

    it("reuses conversation for same user+channel combination", async () => {
      await bridge.start(testConfig);

      const ctx1 = makeTeamsContext({ text: "first" });
      await bridge.handleTurn(ctx1);

      const ctx2 = makeTeamsContext({ text: "second" });
      await bridge.handleTurn(ctx2);

      expect(coo.startNewConversation).toHaveBeenCalledOnce();
      expect(bus.send).toHaveBeenCalledTimes(2);

      // Both messages should use the same conversationId
      const convId1 = bus._sent[0]?.conversationId;
      const convId2 = bus._sent[1]?.conversationId;
      expect(convId1).toBe(convId2);
    });

    it("creates separate conversations for different users", async () => {
      await bridge.start(testConfig);

      const ctx1 = makeTeamsContext({
        text: "hello",
        from: { id: "user1", name: "Alice" },
      });
      await bridge.handleTurn(ctx1);

      const ctx2 = makeTeamsContext({
        text: "hello",
        from: { id: "user2", name: "Bob" },
      });
      await bridge.handleTurn(ctx2);

      expect(coo.startNewConversation).toHaveBeenCalledTimes(2);

      const convId1 = bus._sent[0]?.conversationId;
      const convId2 = bus._sent[1]?.conversationId;
      expect(convId1).not.toBe(convId2);
    });

    it("creates separate conversations for different channels", async () => {
      await bridge.start(testConfig);

      const ctx1 = makeTeamsContext({
        text: "hello",
        from: { id: "user1", name: "Alice" },
        channelId: "channel-a",
      });
      await bridge.handleTurn(ctx1);

      const ctx2 = makeTeamsContext({
        text: "hello",
        from: { id: "user1", name: "Alice" },
        channelId: "channel-b",
      });
      await bridge.handleTurn(ctx2);

      expect(coo.startNewConversation).toHaveBeenCalledTimes(2);
    });

    it("uses userId as name fallback when from.name is missing", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({
        text: "hi",
        from: { id: "user-xyz" },
      });
      await bridge.handleTurn(ctx);

      expect(io.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Teams: user-xyz"),
        }),
      );
    });

    it("stores conversation reference for proactive messaging", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hi" });
      await bridge.handleTurn(ctx);

      // Verify the ref is stored by sending an outbound message
      const conversationId = bus._sent[0]?.conversationId;
      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "reply",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      // Should attempt to send via proactive messaging
      expect(mockContinueConversationAsync).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Outbound: COO → Teams
  // -------------------------------------------------------------------------

  describe("outbound message delivery", () => {
    it("sends COO responses back to Teams via proactive messaging", async () => {
      await bridge.start(testConfig);

      // Establish conversation
      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;
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

      expect(mockContinueConversationAsync).toHaveBeenCalledOnce();
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

      expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    });

    it("ignores COO messages addressed to a specific agent", async () => {
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

      expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    });

    it("ignores messages without a conversationId", async () => {
      await bridge.start(testConfig);

      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "msg-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "No conversation",
        metadata: {},
        conversationId: undefined,
        timestamp: new Date().toISOString(),
      });

      expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    });

    it("ignores messages for unknown conversations", async () => {
      await bridge.start(testConfig);

      const broadcastHandler = bus._broadcastHandlers[0]!;
      broadcastHandler({
        id: "msg-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Unknown conv",
        metadata: {},
        conversationId: "nonexistent-conv",
        timestamp: new Date().toISOString(),
      });

      expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    });

    it("clears pending response after sending reply", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;
      const broadcastHandler = bus._broadcastHandlers[0]!;

      // Send first reply
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "reply 1",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      // Second reply should still work (ref is in conversationRefs, not just pendingResponses)
      broadcastHandler({
        id: "resp-2",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "reply 2",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      expect(mockContinueConversationAsync).toHaveBeenCalledTimes(2);
    });

    it("handles send errors gracefully", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;

      // Make continueConversationAsync reject
      mockContinueConversationAsync.mockRejectedValueOnce(
        new Error("send failed"),
      );

      const broadcastHandler = bus._broadcastHandlers[0]!;
      // Should not throw
      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "reply",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      // Should complete without throwing
      await new Promise((r) => setTimeout(r, 50));
    });

    it("does not send when adapter is null (bridge stopped)", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;

      // Capture the handler before stop
      const broadcastHandler = bus._broadcastHandlers[0];

      await bridge.stop();

      // Manually trigger (shouldn't be possible normally since offBroadcast was called)
      if (broadcastHandler) {
        broadcastHandler({
          id: "resp-1",
          fromAgentId: "coo",
          toAgentId: null,
          type: MessageType.Chat,
          content: "reply",
          metadata: {},
          conversationId,
          timestamp: new Date().toISOString(),
        });
      }

      // continueConversationAsync should not be called after stop
      expect(mockContinueConversationAsync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Tenant ID configuration
  // -------------------------------------------------------------------------

  describe("tenant ID configuration", () => {
    it("defaults to MultiTenant mode when no tenantId is provided", async () => {
      await bridge.start(testConfig);

      expect(mockConfigBotFrameworkAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          MicrosoftAppType: "MultiTenant",
          MicrosoftAppTenantId: undefined,
        }),
      );
    });

    it("uses SingleTenant mode when tenantId is provided", async () => {
      await bridge.start({
        appId: "my-app-id",
        appPassword: "my-secret",
        tenantId: "my-tenant-id",
      });

      expect(mockConfigBotFrameworkAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          MicrosoftAppType: "SingleTenant",
          MicrosoftAppTenantId: "my-tenant-id",
        }),
      );
    });

    it("passes appId and appPassword to authentication config", async () => {
      await bridge.start({
        appId: "my-app-id",
        appPassword: "my-secret",
      });

      expect(mockConfigBotFrameworkAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          MicrosoftAppId: "my-app-id",
          MicrosoftAppPassword: "my-secret",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Message splitting
  // -------------------------------------------------------------------------

  describe("message splitting", () => {
    it("sends short messages as a single chunk", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;
      const broadcastHandler = bus._broadcastHandlers[0]!;

      const sentActivities: unknown[] = [];
      mockContinueConversationAsync.mockImplementationOnce(
        async (_id: string, _ref: unknown, callback: (ctx: unknown) => Promise<void>) => {
          const fakeCtx = {
            sendActivity: vi.fn().mockImplementation((activity: unknown) => {
              sentActivities.push(activity);
              return Promise.resolve();
            }),
          };
          await callback(fakeCtx);
        },
      );

      broadcastHandler({
        id: "resp-1",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "Short reply",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(sentActivities).toHaveLength(1);
    });

    it("splits long messages into multiple chunks", async () => {
      await bridge.start(testConfig);

      const ctx = makeTeamsContext({ text: "hello" });
      await bridge.handleTurn(ctx);

      const conversationId = bus._sent[0]?.conversationId;
      const broadcastHandler = bus._broadcastHandlers[0]!;

      const sentActivities: unknown[] = [];
      mockContinueConversationAsync.mockImplementationOnce(
        async (_id: string, _ref: unknown, callback: (ctx: unknown) => Promise<void>) => {
          const fakeCtx = {
            sendActivity: vi.fn().mockImplementation((activity: unknown) => {
              sentActivities.push(activity);
              return Promise.resolve();
            }),
          };
          await callback(fakeCtx);
        },
      );

      // 4000 chars is the Teams limit; send 10000 chars
      const longMessage = "x".repeat(10000);
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
      expect(sentActivities.length).toBeGreaterThan(1);
    });
  });
});
