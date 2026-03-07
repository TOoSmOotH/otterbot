import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { migrateDb, resetDb } from "../db/index.js";
import { setConfig } from "../auth/auth.js";

const mockChatCreate = vi.fn();
const mockGoogleAuthConstructor = vi.fn();
const mockOAuthVerifyIdToken = vi.fn();

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "conv-googlechat-1"),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: class {
        constructor(config: Record<string, unknown>) {
          mockGoogleAuthConstructor(config);
        }
      },
    },
    chat: vi.fn(() => ({
      spaces: {
        messages: {
          create: (...args: unknown[]) => mockChatCreate(...args),
        },
      },
    })),
  },
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = (...args: unknown[]) => mockOAuthVerifyIdToken(...args);
  },
}));

const { GoogleChatBridge } = await import("./google-chat-bridge.js");

type SendParams = {
  fromAgentId: string | null;
  toAgentId: string | null;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
};

function createMockBus() {
  const sent: SendParams[] = [];
  const broadcastHandlers: ((message: BusMessage) => void)[] = [];

  return {
    send: vi.fn((params: SendParams) => {
      sent.push(params);
      return {
        id: "msg-1",
        timestamp: new Date().toISOString(),
        metadata: {},
        ...params,
      };
    }),
    onBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      broadcastHandlers.push(handler);
    }),
    offBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      const idx = broadcastHandlers.indexOf(handler);
      if (idx >= 0) broadcastHandlers.splice(idx, 1);
    }),
    _sent: sent,
    _broadcastHandlers: broadcastHandlers,
  };
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

describe("GoogleChatBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof GoogleChatBridge>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-googlechat-bridge-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    mockChatCreate.mockReset().mockResolvedValue({});
    mockGoogleAuthConstructor.mockReset();
    mockOAuthVerifyIdToken.mockReset().mockResolvedValue({
      getPayload: () => ({ email: "chat@system.gserviceaccount.com" }),
    });

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    bridge = new GoogleChatBridge({
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

  async function startBridge() {
    await bridge.start({
      serviceAccountKey: {
        client_email: "bot@example.com",
        private_key: "private-key",
      },
      projectNumber: "123456789",
    });
  }

  it("starts and emits connected status", async () => {
    await startBridge();

    expect(mockGoogleAuthConstructor).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({
        client_email: "bot@example.com",
      }),
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    }));
    expect(bus.onBroadcast).toHaveBeenCalledOnce();
    expect(io.emit).toHaveBeenCalledWith("googlechat:status", { status: "connected" });
  });

  it("throws when Authorization header is missing", async () => {
    await startBridge();

    await expect(bridge.verifyBearerToken(undefined)).rejects.toThrow("Missing or invalid Authorization header");
  });

  it("throws when token issuer is not Google Chat", async () => {
    await startBridge();
    mockOAuthVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ email: "someone@example.com" }),
    });

    await expect(bridge.verifyBearerToken("Bearer valid-token")).rejects.toThrow("Token issuer is not Google Chat");
  });

  it("returns welcome text for ADDED_TO_SPACE events", async () => {
    await startBridge();

    const result = await bridge.handleWebhook({ type: "ADDED_TO_SPACE" }, "Bearer token");

    expect(result).toEqual({ text: "Hello! I'm Otterbot. Send me a message to get started." });
  });

  it("returns pairing instructions for unpaired users and emits pairing-request", async () => {
    await startBridge();

    const result = await bridge.handleWebhook(
      {
        type: "MESSAGE",
        space: { name: "spaces/AAA" },
        message: {
          text: "Hello",
          sender: { name: "users/unpaired", displayName: "Alice", type: "HUMAN" },
        },
      },
      "Bearer token",
    );

    expect(result).toEqual(expect.objectContaining({
      text: expect.stringContaining("To pair with me"),
    }));
    expect(io.emit).toHaveBeenCalledWith(
      "googlechat:pairing-request",
      expect.objectContaining({
        googleChatUserId: "users/unpaired",
        googleChatUsername: "Alice",
        code: expect.stringMatching(/^[A-F0-9]{6}$/),
      }),
    );
    expect(bus.send).not.toHaveBeenCalled();
  });

  it("routes paired user message to COO and creates a conversation", async () => {
    await startBridge();
    setConfig("googlechat:paired:users/paired", JSON.stringify({
      googleChatUserId: "users/paired",
      googleChatUsername: "Paired User",
      pairedAt: new Date().toISOString(),
    }));

    const result = await bridge.handleWebhook(
      {
        type: "MESSAGE",
        space: { name: "spaces/AAA" },
        message: {
          text: "Need help",
          sender: { name: "users/paired", displayName: "Paired User", type: "HUMAN" },
          thread: { name: "spaces/AAA/threads/123" },
        },
      },
      "Bearer token",
    );

    expect(result).toEqual({});
    expect(coo.startNewConversation).toHaveBeenCalledWith("conv-googlechat-1", null, null);
    expect(io.emit).toHaveBeenCalledWith(
      "conversation:created",
      expect.objectContaining({
        id: "conv-googlechat-1",
        title: expect.stringContaining("Google Chat: Paired User"),
      }),
    );
    expect(bus.send).toHaveBeenCalledWith(expect.objectContaining({
      toAgentId: "coo",
      type: MessageType.Chat,
      content: "Need help",
      conversationId: "conv-googlechat-1",
      metadata: expect.objectContaining({
        source: "googlechat",
        googleChatUserId: "users/paired",
        googleChatSpaceName: "spaces/AAA",
        googleChatThreadName: "spaces/AAA/threads/123",
      }),
    }));
  });

  it("sends long COO replies in chunks to Google Chat", async () => {
    await startBridge();
    setConfig("googlechat:paired:users/paired", JSON.stringify({
      googleChatUserId: "users/paired",
      googleChatUsername: "Paired User",
      pairedAt: new Date().toISOString(),
    }));

    await bridge.handleWebhook(
      {
        type: "MESSAGE",
        space: { name: "spaces/BBB" },
        message: {
          text: "Start",
          sender: { name: "users/paired", displayName: "Paired User", type: "HUMAN" },
        },
      },
      "Bearer token",
    );

    const broadcast = bus._broadcastHandlers[0];
    expect(broadcast).toBeTypeOf("function");

    broadcast!({
      id: "coo-msg-1",
      fromAgentId: "coo",
      toAgentId: null,
      type: MessageType.Chat,
      content: "A".repeat(9001),
      metadata: {},
      conversationId: "conv-googlechat-1",
      timestamp: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockChatCreate).toHaveBeenCalledTimes(3);
    for (const call of mockChatCreate.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({
        parent: "spaces/BBB",
        requestBody: { text: expect.any(String) },
      }));
    }
  });

  it("stops and emits disconnected status", async () => {
    await startBridge();
    await bridge.stop();

    expect(bus.offBroadcast).toHaveBeenCalledOnce();
    expect(io.emit).toHaveBeenCalledWith("googlechat:status", { status: "disconnected" });
  });
});
