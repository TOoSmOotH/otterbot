import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../db/index.js";

const isPairedMock = vi.fn();
const generatePairingCodeMock = vi.fn();
const nanoidMock = vi.fn();
const loginMock = vi.fn();
const postMock = vi.fn();
const listNotificationsMock = vi.fn();
const updateSeenNotificationsMock = vi.fn();
const resumeSessionMock = vi.fn();
const getTimelineMock = vi.fn();

vi.mock("./pairing.js", () => ({
  isPaired: isPairedMock,
  generatePairingCode: generatePairingCodeMock,
}));

vi.mock("nanoid", () => ({
  nanoid: nanoidMock,
}));

vi.mock("@atproto/api", () => ({
  AtpAgent: class {
    session: { handle: string; did: string };

    constructor(_: { service: string }) {
      this.session = { handle: "otterbot.bsky.social", did: "did:plc:otterbot" };
    }

    async login(params: { identifier: string; password: string }) {
      return loginMock(params);
    }

    async post(payload: unknown) {
      return postMock(payload);
    }

    async getTimeline(params: { limit: number }) {
      return getTimelineMock(params);
    }

    async listNotifications(params: { limit: number }) {
      return listNotificationsMock(params);
    }

    async updateSeenNotifications() {
      return updateSeenNotificationsMock();
    }

    async resumeSession(session: unknown) {
      return resumeSessionMock(session);
    }
  },
  RichText: class {
    text: string;
    facets: unknown[];

    constructor({ text }: { text: string }) {
      this.text = text;
      this.facets = [];
    }

    async detectFacets(_: unknown) {
      return;
    }
  },
  AppBskyNotificationListNotifications: {},
}));

const { BlueskyBridge } = await import("./bluesky-bridge.js");

interface SendParams {
  fromAgentId: string | null;
  toAgentId: string | null;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  conversationId?: string;
}

function createMockBus() {
  const broadcastHandlers: Array<(message: any) => void> = [];
  const sent: SendParams[] = [];

  return {
    send: vi.fn((params: SendParams) => {
      sent.push(params);
      return {
        id: "msg-id",
        ...params,
        timestamp: new Date().toISOString(),
      };
    }),
    onBroadcast: vi.fn((handler: (message: any) => void) => {
      broadcastHandlers.push(handler);
    }),
    offBroadcast: vi.fn((handler: (message: any) => void) => {
      const idx = broadcastHandlers.indexOf(handler);
      if (idx >= 0) broadcastHandlers.splice(idx, 1);
    }),
    _broadcastHandlers: broadcastHandlers,
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

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BlueskyBridge", () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockBus>;
  let coo: ReturnType<typeof createMockCoo>;
  let io: ReturnType<typeof createMockIo>;
  let bridge: InstanceType<typeof BlueskyBridge>;
  let postCounter = 0;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-bluesky-bridge-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    isPairedMock.mockReset();
    generatePairingCodeMock.mockReset();
    nanoidMock.mockReset();
    loginMock.mockReset();
    postMock.mockReset();
    listNotificationsMock.mockReset();
    updateSeenNotificationsMock.mockReset();
    resumeSessionMock.mockReset();
    getTimelineMock.mockReset();
    postCounter = 0;

    loginMock.mockResolvedValue({
      data: {
        did: "did:plc:otterbot",
        handle: "otterbot.bsky.social",
      },
    });
    listNotificationsMock.mockResolvedValue({ data: { notifications: [] } });
    updateSeenNotificationsMock.mockResolvedValue(undefined);
    postMock.mockImplementation(async () => {
      postCounter += 1;
      return {
        uri: `at://post/${postCounter}`,
        cid: `cid-${postCounter}`,
      };
    });
    getTimelineMock.mockResolvedValue({ data: { feed: [] } });
    nanoidMock.mockReturnValue("conv-1");

    bus = createMockBus();
    coo = createMockCoo();
    io = createMockIo();
    bridge = new BlueskyBridge({ bus: bus as any, coo: coo as any, io: io as any });
  });

  afterEach(async () => {
    await bridge.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts, logs in, polls notifications, and emits status", async () => {
    await bridge.start({ identifier: "otterbot", appPassword: "pass" });
    await flush();

    expect(loginMock).toHaveBeenCalledWith({
      identifier: "otterbot",
      password: "pass",
    });
    expect(listNotificationsMock).toHaveBeenCalledWith({ limit: 25 });
    expect(updateSeenNotificationsMock).toHaveBeenCalledTimes(1);
    expect(bus.onBroadcast).toHaveBeenCalledTimes(1);
    expect(io.emit).toHaveBeenCalledWith("bluesky:status", {
      status: "connected",
      handle: "otterbot.bsky.social",
    });
  });

  it("for unpaired users, generates pairing code, replies with instructions, and emits pairing request", async () => {
    isPairedMock.mockReturnValue(false);
    generatePairingCodeMock.mockReturnValue("PAIR01");
    listNotificationsMock.mockResolvedValue({
      data: {
        notifications: [{
          reason: "mention",
          indexedAt: "2026-03-05T00:00:00.000Z",
          uri: "at://post/original",
          cid: "cid-original",
          author: { did: "did:plc:alice", handle: "alice.bsky.social" },
          record: { text: "@otterbot.bsky.social hello" },
        }],
      },
    });

    await bridge.start({ identifier: "otterbot", appPassword: "pass" });
    await flush();

    expect(generatePairingCodeMock).toHaveBeenCalledWith("did:plc:alice", "alice.bsky.social");
    expect(postMock).toHaveBeenCalledWith(expect.objectContaining({
      reply: {
        root: { uri: "at://post/original", cid: "cid-original" },
        parent: { uri: "at://post/original", cid: "cid-original" },
      },
      text: expect.stringContaining("PAIR01"),
    }));
    expect(io.emit).toHaveBeenCalledWith("bluesky:pairing-request", {
      code: "PAIR01",
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
    });
    expect(bus.send).not.toHaveBeenCalled();
  });

  it("routes paired mentions to COO and replies when COO responds", async () => {
    isPairedMock.mockReturnValue(true);
    nanoidMock.mockReturnValue("conv-123");
    listNotificationsMock.mockResolvedValue({
      data: {
        notifications: [{
          reason: "mention",
          indexedAt: "2026-03-05T00:00:00.000Z",
          uri: "at://post/original",
          cid: "cid-original",
          author: { did: "did:plc:alice", handle: "alice.bsky.social" },
          record: { text: "@otterbot.bsky.social hello there" },
        }],
      },
    });

    await bridge.start({ identifier: "otterbot", appPassword: "pass" });
    await flush();

    expect(coo.startNewConversation).toHaveBeenCalledWith("conv-123", null, null);
    expect(io.emit).toHaveBeenCalledWith("conversation:created", expect.objectContaining({
      id: "conv-123",
      projectId: null,
      title: expect.stringContaining("Bluesky: @alice.bsky.social"),
    }));
    expect(bus.send).toHaveBeenCalledWith(expect.objectContaining({
      fromAgentId: null,
      toAgentId: "coo",
      content: "hello there",
      conversationId: "conv-123",
      metadata: expect.objectContaining({
        source: "bluesky",
        blueskyDid: "did:plc:alice",
        blueskyHandle: "alice.bsky.social",
        postUri: "at://post/original",
      }),
    }));

    const handler = bus._broadcastHandlers[0];
    expect(handler).toBeTypeOf("function");
    handler({
      fromAgentId: "coo",
      toAgentId: null,
      conversationId: "conv-123",
      content: "Thanks for the message",
      type: "chat",
      id: "msg2",
      timestamp: new Date().toISOString(),
      metadata: {},
    });
    await flush();

    expect(postMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "Thanks for the message",
      reply: {
        root: { uri: "at://post/original", cid: "cid-original" },
        parent: { uri: "at://post/original", cid: "cid-original" },
      },
    }));
  });

  it("splits long COO replies into threaded chunks", async () => {
    isPairedMock.mockReturnValue(true);
    listNotificationsMock.mockResolvedValue({
      data: {
        notifications: [{
          reason: "reply",
          indexedAt: "2026-03-05T00:00:00.000Z",
          uri: "at://post/root-parent",
          cid: "cid-root-parent",
          author: { did: "did:plc:alice", handle: "alice.bsky.social" },
          record: {
            text: "@otterbot.bsky.social ping",
            reply: { root: { uri: "at://post/root", cid: "cid-root" } },
          },
        }],
      },
    });

    await bridge.start({ identifier: "otterbot", appPassword: "pass" });
    await flush();

    const handler = bus._broadcastHandlers[0];
    const longMessage = "a".repeat(901);
    handler({
      fromAgentId: "coo",
      toAgentId: null,
      conversationId: "conv-1",
      content: longMessage,
      type: "chat",
      id: "msg3",
      timestamp: new Date().toISOString(),
      metadata: {},
    });
    await flush();

    expect(postMock).toHaveBeenCalledTimes(4);
    expect(postMock.mock.calls[0]![0]).toMatchObject({
      reply: {
        root: { uri: "at://post/root", cid: "cid-root" },
        parent: { uri: "at://post/root-parent", cid: "cid-root-parent" },
      },
    });
    expect(postMock.mock.calls[1]![0]).toMatchObject({
      reply: {
        root: { uri: "at://post/root", cid: "cid-root" },
        parent: { uri: "at://post/1", cid: "cid-1" },
      },
    });
    expect(postMock.mock.calls[2]![0]).toMatchObject({
      reply: {
        root: { uri: "at://post/root", cid: "cid-root" },
        parent: { uri: "at://post/2", cid: "cid-2" },
      },
    });
    expect(postMock.mock.calls[3]![0]).toMatchObject({
      reply: {
        root: { uri: "at://post/root", cid: "cid-root" },
        parent: { uri: "at://post/3", cid: "cid-3" },
      },
    });
  });
});
