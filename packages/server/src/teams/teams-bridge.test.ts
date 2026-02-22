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

const mockSendActivity = vi.fn().mockResolvedValue({ id: "activity-1" });
const mockGetConversationReference = vi.fn().mockReturnValue({
  activityId: "act-1",
  user: { id: "user-1", name: "Test User" },
  conversation: { id: "conv-1" },
  channelId: "msteams",
  serviceUrl: "https://smba.trafficmanager.net/teams/",
});
const mockContinueConversationAsync = vi.fn().mockImplementation(
  async (_appId: string, _ref: unknown, callback: (ctx: unknown) => Promise<void>) => {
    await callback({ sendActivity: mockSendActivity });
  },
);

// Mock botbuilder module — vi.fn() alone isn't constructable, so we use
// class stubs that record their constructor args for assertions.
const configBotFrameworkAuthInstances: unknown[] = [];

vi.mock("botbuilder", () => {
  class MockConfigurationBotFrameworkAuthentication {
    constructor(config: unknown) {
      configBotFrameworkAuthInstances.push(config);
    }
  }

  class MockCloudAdapter {
    onTurnError: unknown = null;
    continueConversationAsync = mockContinueConversationAsync;
    process = vi.fn();
  }

  return {
    ConfigurationBotFrameworkAuthentication: MockConfigurationBotFrameworkAuthentication,
    CloudAdapter: MockCloudAdapter,
    ActivityTypes: { Message: "message" },
    TurnContext: {
      getConversationReference: mockGetConversationReference,
    },
    MessageFactory: {
      text: vi.fn((t: string) => ({ type: "message", text: t })),
    },
  };
});

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBus(): MessageBus {
  return new MessageBus();
}

function makeTurnContext(opts?: {
  text?: string;
  userId?: string;
  userName?: string;
  channelId?: string;
}) {
  return {
    activity: {
      type: "message",
      text: opts?.text ?? "Hello from Teams",
      from: {
        id: opts?.userId ?? "user-1",
        name: opts?.userName ?? "Test User",
      },
      channelId: opts?.channelId ?? "msteams",
      conversation: { id: "conv-1" },
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    },
    sendActivity: mockSendActivity,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TeamsBridge", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-teams-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();

    configStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createBridge() {
    const { TeamsBridge } = await import("./teams-bridge.js");
    return new TeamsBridge({ bus, coo: mockCoo, io: mockIo });
  }

  describe("connection lifecycle", () => {
    it("emits teams:status connected on start", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      expect(mockIo.emit).toHaveBeenCalledWith("teams:status", {
        status: "connected",
      });
    });

    it("emits teams:status disconnected on stop", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });
      await bridge.stop();

      expect(mockIo.emit).toHaveBeenCalledWith("teams:status", {
        status: "disconnected",
      });
    });

    it("stops previous adapter when starting a new one", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "app1", appPassword: "pass1" });
      await bridge.start({ appId: "app2", appPassword: "pass2" });

      // Should have emitted disconnected then connected again
      const statusCalls = mockIo.emit.mock.calls.filter(
        (c: unknown[]) => c[0] === "teams:status",
      );
      expect(statusCalls).toHaveLength(3); // connected, disconnected, connected
    });

    it("returns the adapter via getAdapter()", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      expect(bridge.getAdapter()).toBeTruthy();
    });

    it("returns null adapter when not started", async () => {
      const bridge = await createBridge();
      expect(bridge.getAdapter()).toBeNull();
    });
  });

  describe("receiving messages", () => {
    it("routes a text message to the bus", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      const busSendSpy = vi.spyOn(bus, "send");
      const ctx = makeTurnContext({ text: "Hello Otterbot!" });

      await bridge.handleTurn(ctx);

      expect(busSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "Hello Otterbot!",
          metadata: expect.objectContaining({
            source: "teams",
            teamsUserId: "user-1",
            teamsChannelId: "msteams",
          }),
        }),
      );
    });

    it("ignores non-message activities", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      const busSendSpy = vi.spyOn(bus, "send");

      await bridge.handleTurn({
        activity: { type: "conversationUpdate", from: { id: "u1" } },
      });

      expect(busSendSpy).not.toHaveBeenCalled();
    });

    it("ignores empty messages", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      const busSendSpy = vi.spyOn(bus, "send");

      await bridge.handleTurn({
        activity: { type: "message", text: "   ", from: { id: "u1" }, channelId: "msteams" },
      });

      expect(busSendSpy).not.toHaveBeenCalled();
    });

    it("creates a new conversation for new user/channel pairs", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      const ctx = makeTurnContext({ text: "First message" });
      await bridge.handleTurn(ctx);

      expect(mockCoo.startNewConversation).toHaveBeenCalledTimes(1);
      expect(mockIo.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Teams:"),
        }),
      );
    });
  });

  describe("sending messages", () => {
    it("sends COO response back to Teams via proactive message", async () => {
      const bridge = await createBridge();
      await bridge.start({ appId: "test-app-id", appPassword: "test-secret" });

      // Trigger inbound to establish conversation mapping
      const ctx = makeTurnContext({ text: "What is 2+2?" });
      await bridge.handleTurn(ctx);

      const conversationId = mockCoo.startNewConversation.mock.calls[0]?.[0];
      expect(conversationId).toBeTruthy();

      mockSendActivity.mockClear();

      // Simulate COO response via bus broadcast
      bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "The answer is 4.",
        conversationId,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockContinueConversationAsync).toHaveBeenCalled();
    });
  });

  describe("tenant ID configuration", () => {
    it("passes tenantId to ConfigurationBotFrameworkAuthentication when provided", async () => {
      configBotFrameworkAuthInstances.length = 0;
      const bridge = await createBridge();

      await bridge.start({
        appId: "test-app-id",
        appPassword: "test-secret",
        tenantId: "my-tenant-id",
      });

      expect(configBotFrameworkAuthInstances).toHaveLength(1);
      expect(configBotFrameworkAuthInstances[0]).toEqual(
        expect.objectContaining({
          MicrosoftAppId: "test-app-id",
          MicrosoftAppPassword: "test-secret",
          MicrosoftAppType: "SingleTenant",
          MicrosoftAppTenantId: "my-tenant-id",
        }),
      );
    });

    it("uses MultiTenant when no tenantId is provided", async () => {
      configBotFrameworkAuthInstances.length = 0;
      const bridge = await createBridge();

      await bridge.start({
        appId: "test-app-id",
        appPassword: "test-secret",
      });

      expect(configBotFrameworkAuthInstances).toHaveLength(1);
      expect(configBotFrameworkAuthInstances[0]).toEqual(
        expect.objectContaining({
          MicrosoftAppType: "MultiTenant",
        }),
      );
    });
  });
});
