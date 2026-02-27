import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const { NextcloudTalkBridge } = await import("../nextcloud-talk-bridge.js");

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
  serverUrl: "https://nextcloud.example.com",
  username: "otterbot",
  appPassword: "test-app-password",
};

describe("NextcloudTalkBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof NextcloudTalkBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-nctalk-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    mockFetchResponses.clear();

    // Default: /ocs/v2.php/cloud/user returns the bot user
    setFetchResponse("/ocs/v2.php/cloud/user", {
      body: { ocs: { data: { id: "otterbot", displayname: "Otterbot" } } },
    });

    bridge = new NextcloudTalkBridge({
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
    it("authenticates with Nextcloud", async () => {
      await bridge.start(testConfig);

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const authCalls = fetchCalls.filter(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/ocs/v2.php/cloud/user"),
      );
      expect(authCalls.length).toBeGreaterThanOrEqual(1);

      // Check auth header
      const headers = (authCalls[0]![1] as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Basic /);
      expect(headers["OCS-APIRequest"]).toBe("true");
    });

    it("emits connected status on successful start", async () => {
      await bridge.start(testConfig);

      expect(io.emit).toHaveBeenCalledWith("nextcloud-talk:status", {
        status: "connected",
        botUsername: "Otterbot",
      });
    });

    it("subscribes to bus broadcasts", async () => {
      await bridge.start(testConfig);

      expect(bus.onBroadcast).toHaveBeenCalledOnce();
    });

    it("throws on auth failure", async () => {
      setFetchResponse("/ocs/v2.php/cloud/user", {
        ok: false,
        status: 401,
        body: { message: "Unauthorized" },
      });

      await expect(bridge.start(testConfig)).rejects.toThrow("Nextcloud Talk auth failed");
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

      expect(io.emit).toHaveBeenCalledWith("nextcloud-talk:status", {
        status: "disconnected",
      });
    });

    it("can restart after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      await bridge.start(testConfig);

      expect(io.emit).toHaveBeenCalledWith("nextcloud-talk:status", {
        status: "connected",
        botUsername: "Otterbot",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Message sending
  // -------------------------------------------------------------------------

  describe("sendMessage", () => {
    it("sends messages via the OCS API", async () => {
      await bridge.start(testConfig);

      setFetchResponse("/api/v1/chat/room-token-1", {
        body: { ocs: { data: {} } },
      });

      await bridge.sendMessage("room-token-1", "Hello from Otterbot!");

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const chatCalls = fetchCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/api/v1/chat/room-token-1") &&
          (c[1] as RequestInit)?.method === "POST",
      );
      expect(chatCalls.length).toBe(1);

      const body = JSON.parse((chatCalls[0]![1] as RequestInit).body as string);
      expect(body.message).toBe("Hello from Otterbot!");
    });

    it("throws on send failure", async () => {
      await bridge.start(testConfig);

      setFetchResponse("/api/v1/chat/room-token-1", {
        ok: false,
        status: 403,
        body: { message: "Forbidden" },
      });

      await expect(bridge.sendMessage("room-token-1", "test")).rejects.toThrow(
        "Failed to send message: HTTP 403",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Outbound Messages (COO → Nextcloud Talk)
  // -------------------------------------------------------------------------

  describe("outbound messages", () => {
    it("ignores messages not from COO", async () => {
      await bridge.start(testConfig);

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
      setFetchResponse("/ocs/v2.php/cloud/user", {
        body: { ocs: { data: { id: "otterbot", displayname: "Otterbot" } } },
      });

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
      const chatCalls = fetchCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/api/v1/chat/"),
      );
      expect(chatCalls.length).toBe(0);
    });

    it("ignores COO messages addressed to another agent", async () => {
      await bridge.start(testConfig);

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
      setFetchResponse("/ocs/v2.php/cloud/user", {
        body: { ocs: { data: { id: "otterbot", displayname: "Otterbot" } } },
      });

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
      const chatCalls = fetchCalls.filter(
        (c: unknown[]) =>
          typeof c[0] === "string" &&
          c[0].includes("/api/v1/chat/"),
      );
      expect(chatCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // getJoinedRooms
  // -------------------------------------------------------------------------

  describe("getJoinedRooms", () => {
    it("returns empty array when not started", async () => {
      const rooms = await bridge.getJoinedRooms();
      expect(rooms).toEqual([]);
    });

    it("returns rooms from the API", async () => {
      await bridge.start(testConfig);

      setFetchResponse("/ocs/v2.php/apps/spreed/api/v4/room", {
        body: {
          ocs: {
            data: [
              { token: "room1", name: "general", displayName: "General", type: 2 },
              { token: "room2", name: "random", displayName: "Random", type: 3 },
            ],
          },
        },
      });

      const rooms = await bridge.getJoinedRooms();
      expect(rooms).toEqual([
        { token: "room1", name: "general", displayName: "General", type: 2 },
        { token: "room2", name: "random", displayName: "Random", type: 3 },
      ]);
    });

    it("returns empty array on API error", async () => {
      await bridge.start(testConfig);

      setFetchResponse("/ocs/v2.php/apps/spreed/api/v4/room", {
        ok: false,
        status: 500,
        body: { message: "Server error" },
      });

      const rooms = await bridge.getJoinedRooms();
      expect(rooms).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("does not throw when sendMessage is called after stop", async () => {
      await bridge.start(testConfig);
      await bridge.stop();

      // sendMessage should not throw, it should simply return (no config)
      await expect(bridge.sendMessage("room-token", "hello")).resolves.toBeUndefined();
    });

    it("handles auth header generation correctly", async () => {
      await bridge.start(testConfig);

      const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const authCall = fetchCalls.find(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("/ocs/v2.php/cloud/user"),
      );
      const headers = (authCall![1] as RequestInit).headers as Record<string, string>;
      const expectedAuth = "Basic " + Buffer.from("otterbot:test-app-password").toString("base64");
      expect(headers.Authorization).toBe(expectedAuth);
    });
  });
});

// ---------------------------------------------------------------------------
// Settings tests
// ---------------------------------------------------------------------------

describe("NextcloudTalkSettings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-nctalk-settings-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    mockFetchResponses.clear();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
    mockFetchResponses.clear();
  });

  it("returns default settings when nothing is configured", async () => {
    const { getNextcloudTalkSettings } = await import("../nextcloud-talk-settings.js");
    const settings = getNextcloudTalkSettings();

    expect(settings.enabled).toBe(false);
    expect(settings.serverUrl).toBeNull();
    expect(settings.serverUrlSet).toBe(false);
    expect(settings.usernameSet).toBe(false);
    expect(settings.appPasswordSet).toBe(false);
    expect(settings.botUsername).toBeNull();
    expect(settings.requireMention).toBe(true);
    expect(settings.allowedConversations).toEqual([]);
    expect(settings.pairedUsers).toEqual([]);
    expect(settings.pendingPairings).toEqual([]);
  });

  it("updates and retrieves settings", async () => {
    const { getNextcloudTalkSettings, updateNextcloudTalkSettings } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({
      enabled: true,
      serverUrl: "https://nextcloud.example.com/",
      username: "otterbot",
      appPassword: "secret123",
      requireMention: false,
      allowedConversations: ["room1", "room2"],
    });

    const settings = getNextcloudTalkSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.serverUrl).toBe("https://nextcloud.example.com"); // trailing slash stripped
    expect(settings.serverUrlSet).toBe(true);
    expect(settings.usernameSet).toBe(true);
    expect(settings.appPasswordSet).toBe(true);
    expect(settings.botUsername).toBe("otterbot");
    expect(settings.requireMention).toBe(false);
    expect(settings.allowedConversations).toEqual(["room1", "room2"]);
  });

  it("clears settings when empty strings are provided", async () => {
    const { getNextcloudTalkSettings, updateNextcloudTalkSettings } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({
      serverUrl: "https://nextcloud.example.com",
      username: "otterbot",
      appPassword: "secret123",
    });

    updateNextcloudTalkSettings({
      serverUrl: "",
      username: "",
      appPassword: "",
    });

    const settings = getNextcloudTalkSettings();
    expect(settings.serverUrlSet).toBe(false);
    expect(settings.usernameSet).toBe(false);
    expect(settings.appPasswordSet).toBe(false);
  });

  it("tests connection successfully", async () => {
    const { updateNextcloudTalkSettings, testNextcloudTalkConnection } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({
      serverUrl: "https://nextcloud.example.com",
      username: "otterbot",
      appPassword: "secret123",
    });

    setFetchResponse("/ocs/v2.php/cloud/user", {
      body: { ocs: { data: { id: "otterbot", displayname: "Otterbot" } } },
    });

    const result = await testNextcloudTalkConnection();
    expect(result.ok).toBe(true);
    expect(result.botUsername).toBe("Otterbot");
    expect(result.latencyMs).toBeDefined();
  });

  it("returns error when server URL is not configured", async () => {
    const { testNextcloudTalkConnection } = await import("../nextcloud-talk-settings.js");

    const result = await testNextcloudTalkConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Nextcloud server URL not configured.");
  });

  it("returns error when username is not configured", async () => {
    const { updateNextcloudTalkSettings, testNextcloudTalkConnection } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({ serverUrl: "https://nextcloud.example.com" });

    const result = await testNextcloudTalkConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Nextcloud username not configured.");
  });

  it("returns error when app password is not configured", async () => {
    const { updateNextcloudTalkSettings, testNextcloudTalkConnection } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({
      serverUrl: "https://nextcloud.example.com",
      username: "otterbot",
    });

    const result = await testNextcloudTalkConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Nextcloud app password not configured.");
  });

  it("returns error on connection failure", async () => {
    const { updateNextcloudTalkSettings, testNextcloudTalkConnection } = await import(
      "../nextcloud-talk-settings.js"
    );

    updateNextcloudTalkSettings({
      serverUrl: "https://nextcloud.example.com",
      username: "otterbot",
      appPassword: "secret123",
    });

    setFetchResponse("/ocs/v2.php/cloud/user", {
      ok: false,
      status: 401,
      body: "Unauthorized",
    });

    const result = await testNextcloudTalkConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
  });
});

// ---------------------------------------------------------------------------
// Pairing tests
// ---------------------------------------------------------------------------

describe("NextcloudTalkPairing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-nctalk-pairing-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates and approves pairing codes", async () => {
    const {
      generatePairingCode,
      isPaired,
      approvePairing,
      listPairedUsers,
      listPendingPairings,
    } = await import("../pairing.js");

    expect(isPaired("user1")).toBe(false);

    const code = generatePairingCode("user1", "Alice");
    expect(code).toMatch(/^[0-9A-F]{6}$/);

    expect(listPendingPairings().length).toBe(1);
    expect(listPendingPairings()[0]!.nextcloudUserId).toBe("user1");

    const result = approvePairing(code);
    expect(result).not.toBeNull();
    expect(result!.nextcloudUserId).toBe("user1");
    expect(result!.nextcloudDisplayName).toBe("Alice");

    expect(isPaired("user1")).toBe(true);
    expect(listPairedUsers().length).toBe(1);
    expect(listPendingPairings().length).toBe(0);
  });

  it("rejects pairing codes", async () => {
    const { generatePairingCode, rejectPairing, isPaired, listPendingPairings } =
      await import("../pairing.js");

    const code = generatePairingCode("user1", "Alice");
    expect(listPendingPairings().length).toBe(1);

    const result = rejectPairing(code);
    expect(result).toBe(true);

    expect(isPaired("user1")).toBe(false);
    expect(listPendingPairings().length).toBe(0);
  });

  it("revokes paired users", async () => {
    const { generatePairingCode, approvePairing, revokePairing, isPaired } =
      await import("../pairing.js");

    const code = generatePairingCode("user1", "Alice");
    approvePairing(code);
    expect(isPaired("user1")).toBe(true);

    const result = revokePairing("user1");
    expect(result).toBe(true);
    expect(isPaired("user1")).toBe(false);
  });

  it("returns false for invalid pairing code", async () => {
    const { approvePairing, rejectPairing } = await import("../pairing.js");

    expect(approvePairing("INVALID")).toBeNull();
    expect(rejectPairing("INVALID")).toBe(false);
  });

  it("returns false when revoking non-existent user", async () => {
    const { revokePairing } = await import("../pairing.js");

    expect(revokePairing("nonexistent")).toBe(false);
  });

  it("replaces old pairing code when generating new one", async () => {
    const { generatePairingCode, listPendingPairings, approvePairing } =
      await import("../pairing.js");

    const code1 = generatePairingCode("user1", "Alice");
    const code2 = generatePairingCode("user1", "Alice");

    expect(code1).not.toBe(code2);
    expect(listPendingPairings().length).toBe(1);

    // Old code should be invalid
    expect(approvePairing(code1)).toBeNull();

    // New code should work
    const result = approvePairing(code2);
    expect(result).not.toBeNull();
  });
});
