import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageType } from "@otterbot/shared";
import type { BusMessage } from "@otterbot/shared";
import { migrateDb, resetDb } from "../../db/index.js";

const mockIsPaired = vi.fn();
const mockGeneratePairingCode = vi.fn();

const mockVerifyCredentials = vi.fn();
const mockNotificationsList = vi.fn();
const mockStatusesCreate = vi.fn();
const mockTimelineList = vi.fn();

vi.mock("../pairing.js", () => ({
  isPaired: (...args: unknown[]) => mockIsPaired(...args),
  generatePairingCode: (...args: unknown[]) => mockGeneratePairingCode(...args),
}));

vi.mock("masto", () => ({
  createRestAPIClient: vi.fn(() => ({
    v1: {
      accounts: {
        verifyCredentials: (...args: unknown[]) => mockVerifyCredentials(...args),
      },
      notifications: {
        list: (...args: unknown[]) => mockNotificationsList(...args),
      },
      statuses: {
        create: (...args: unknown[]) => mockStatusesCreate(...args),
      },
      timelines: {
        home: {
          list: (...args: unknown[]) => mockTimelineList(...args),
        },
      },
    },
  })),
  createStreamingAPIClient: vi.fn(() => {
    throw new Error("streaming unavailable");
  }),
}));

interface SendParams {
  fromAgentId: string | null;
  toAgentId: string | null;
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

function createMockBus() {
  const handlers: Array<(message: BusMessage) => void> = [];
  const sent: SendParams[] = [];

  return {
    send: vi.fn((params: SendParams) => {
      sent.push(params);
      return {
        id: "msg-id",
        fromAgentId: params.fromAgentId,
        toAgentId: params.toAgentId,
        type: params.type,
        content: params.content,
        metadata: params.metadata ?? {},
        conversationId: params.conversationId,
        timestamp: new Date().toISOString(),
      } as BusMessage;
    }),
    onBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      handlers.push(handler);
    }),
    offBroadcast: vi.fn((handler: (message: BusMessage) => void) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }),
    _handlers: handlers,
    _sent: sent,
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

describe("MastodonBridge", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-mastodon-bridge-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    vi.clearAllMocks();

    mockVerifyCredentials.mockResolvedValue({
      id: "bot-id",
      acct: "otterbot",
    });
    mockNotificationsList.mockResolvedValue([]);
    mockStatusesCreate.mockResolvedValue({ id: "reply-1", url: null });
    mockTimelineList.mockResolvedValue([]);
    mockGeneratePairingCode.mockReturnValue("ABC123");
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function createBridge() {
    const { MastodonBridge } = await import("../mastodon-bridge.js");
    const bus = createMockBus();
    const coo = createMockCoo();
    const io = createMockIo();

    const bridge = new MastodonBridge({ bus: bus as any, coo: coo as any, io: io as any });
    return { bridge, bus, coo, io };
  }

  it("posts pairing instructions for unpaired mentions", async () => {
    mockIsPaired.mockReturnValue(false);
    mockNotificationsList.mockResolvedValue([
      {
        id: "n1",
        type: "mention",
        account: { id: "user-1", acct: "alice" },
        status: {
          id: "status-1",
          visibility: "public",
          content: "<p>@otterbot hello</p>",
        },
      },
    ]);

    const { bridge, bus, io } = await createBridge();

    await bridge.start({
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    await vi.waitFor(() => {
      expect(mockStatusesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          inReplyToId: "status-1",
          visibility: "public",
        }),
      );
    });

    expect(mockGeneratePairingCode).toHaveBeenCalledWith("user-1", "alice");
    await vi.waitFor(() => {
      expect(io.emit).toHaveBeenCalledWith("mastodon:pairing-request", {
        code: "ABC123",
        mastodonId: "user-1",
        mastodonAcct: "alice",
      });
    });
    expect(bus.send).not.toHaveBeenCalled();

    await bridge.stop();
  });

  it("routes paired mentions to COO and replies to pending conversations", async () => {
    mockIsPaired.mockReturnValue(true);
    mockNotificationsList.mockResolvedValue([
      {
        id: "n2",
        type: "mention",
        account: { id: "user-2", acct: "bob" },
        status: {
          id: "status-2",
          visibility: "unlisted",
          content: "<p>@otterbot Please summarize this</p>",
        },
      },
    ]);

    const { bridge, bus, coo } = await createBridge();

    await bridge.start({
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    await vi.waitFor(() => {
      expect(bus.send).toHaveBeenCalledWith(
        expect.objectContaining({
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "Please summarize this",
          metadata: expect.objectContaining({
            source: "mastodon",
            mastodonId: "user-2",
            mastodonAcct: "bob",
            statusId: "status-2",
          }),
        }),
      );
    });

    expect(coo.startNewConversation).toHaveBeenCalledOnce();

    const conversationId = (bus.send as ReturnType<typeof vi.fn>).mock.calls[0][0].conversationId as string;
    expect(typeof conversationId).toBe("string");

    const handler = (bus as ReturnType<typeof createMockBus>)._handlers[0];
    expect(handler).toBeDefined();

    handler?.({
      id: "coo-msg",
      fromAgentId: "coo",
      toAgentId: null,
      type: MessageType.Chat,
      content: "Here is your summary",
      metadata: {},
      conversationId,
      timestamp: new Date().toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockStatusesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "Here is your summary",
          inReplyToId: "status-2",
          visibility: "unlisted",
        }),
      );
    });

    await bridge.stop();
  });

  it("ignores mentions from the bot account itself", async () => {
    mockIsPaired.mockReturnValue(true);
    mockNotificationsList.mockResolvedValue([
      {
        id: "n-self",
        type: "mention",
        account: { id: "bot-id", acct: "otterbot" },
        status: {
          id: "status-self",
          visibility: "public",
          content: "<p>@otterbot hello from myself</p>",
        },
      },
    ]);

    const { bridge, bus } = await createBridge();

    await bridge.start({
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    await vi.waitFor(() => {
      expect(mockNotificationsList).toHaveBeenCalled();
    });

    expect(bus.send).not.toHaveBeenCalled();
    expect(mockStatusesCreate).not.toHaveBeenCalled();

    await bridge.stop();
  });

  it("emits error status when polling receives auth failures", async () => {
    mockNotificationsList.mockRejectedValue(new Error("401 Unauthorized"));

    const { bridge, io } = await createBridge();

    await bridge.start({
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    await vi.waitFor(() => {
      expect(io.emit).toHaveBeenCalledWith("mastodon:status", { status: "error" });
    });

    await bridge.stop();
  });

  it("splits long COO replies into a threaded sequence", async () => {
    mockIsPaired.mockReturnValue(true);
    mockNotificationsList.mockResolvedValue([
      {
        id: "n3",
        type: "mention",
        account: { id: "user-3", acct: "charlie" },
        status: {
          id: "status-3",
          visibility: "public",
          content: "<p>@otterbot give me a long answer</p>",
        },
      },
    ]);

    let replyCounter = 0;
    mockStatusesCreate.mockImplementation(async () => {
      replyCounter += 1;
      return { id: `reply-${replyCounter}`, url: null };
    });

    const { bridge, bus } = await createBridge();

    await bridge.start({
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    await vi.waitFor(() => {
      expect(bus.send).toHaveBeenCalledOnce();
    });

    const conversationId = (bus.send as ReturnType<typeof vi.fn>).mock.calls[0][0].conversationId as string;
    const handler = (bus as ReturnType<typeof createMockBus>)._handlers[0];
    const longReply = "x".repeat(750);

    handler?.({
      id: "coo-msg-long",
      fromAgentId: "coo",
      toAgentId: null,
      type: MessageType.Chat,
      content: longReply,
      metadata: {},
      conversationId,
      timestamp: new Date().toISOString(),
    });

    await vi.waitFor(() => {
      expect(mockStatusesCreate).toHaveBeenCalledTimes(2);
    });

    expect(mockStatusesCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        inReplyToId: "status-3",
        visibility: "public",
      }),
    );
    expect(mockStatusesCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        inReplyToId: "reply-1",
        visibility: "public",
      }),
    );

    await bridge.stop();
  });
});
