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

// We mock matrix-js-sdk and capture registered event handlers
const mockSendMessage = vi.fn().mockResolvedValue({ event_id: "$ev1" });
const mockSendTyping = vi.fn().mockResolvedValue({});
const mockStartClient = vi.fn().mockResolvedValue(undefined);
const mockStopClient = vi.fn();
const mockGetUserId = vi.fn().mockReturnValue("@bot:example.com");
const mockGetRooms = vi.fn().mockReturnValue([]);
const mockUploadContent = vi.fn().mockResolvedValue({ content_uri: "mxc://example.com/file1" });

// Accumulator for event listeners registered via .on()
let clientEventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

const mockMatrixClient = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (!clientEventHandlers[event]) clientEventHandlers[event] = [];
    clientEventHandlers[event].push(handler);
  }),
  off: vi.fn(),
  sendMessage: mockSendMessage,
  sendTyping: mockSendTyping,
  startClient: mockStartClient,
  stopClient: mockStopClient,
  getUserId: mockGetUserId,
  getRooms: mockGetRooms,
  uploadContent: mockUploadContent,
};

vi.mock("matrix-js-sdk", () => ({
  createClient: vi.fn(() => mockMatrixClient),
  ClientEvent: { Sync: "sync" },
  RoomEvent: { Timeline: "Room.timeline" },
  EventType: { RoomMessage: "m.room.message" },
  MsgType: {
    Text: "m.text",
    Notice: "m.notice",
    Emote: "m.emote",
    Image: "m.image",
    Video: "m.video",
    Audio: "m.audio",
    File: "m.file",
  },
}));

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

function emitClientEvent(event: string, ...args: unknown[]) {
  const handlers = clientEventHandlers[event];
  if (handlers) {
    for (const h of handlers) {
      h(...args);
    }
  }
}

function makeMatrixEvent(opts: {
  type?: string;
  sender?: string;
  roomId?: string;
  content?: Record<string, unknown>;
  eventId?: string;
}) {
  return {
    getType: () => opts.type ?? "m.room.message",
    getSender: () => opts.sender ?? "@user:example.com",
    getRoomId: () => opts.roomId ?? "!room1:example.com",
    getContent: () => opts.content ?? { msgtype: "m.text", body: "Hello bot" },
    getId: () => opts.eventId ?? "$event1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MatrixBridge", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-matrix-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();

    // Reset mock states
    configStore.clear();
    clientEventHandlers = {};
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Dynamic import to get the module after mocks are set
  async function createBridge() {
    const { MatrixBridge } = await import("./matrix-bridge.js");
    return new MatrixBridge({ bus, coo: mockCoo, io: mockIo });
  }

  describe("connection initialization", () => {
    it("starts the matrix client with provided credentials", async () => {
      const bridge = await createBridge();
      const { createClient } = await import("matrix-js-sdk");

      await bridge.start("https://matrix.example.com", "syt_token123");

      expect(createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: "https://matrix.example.com",
          accessToken: "syt_token123",
        }),
      );
      expect(mockStartClient).toHaveBeenCalledWith({ initialSyncLimit: 0 });
    });

    it("emits matrix:status connected on sync PREPARED", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "syt_token");

      // Simulate sync ready
      emitClientEvent("sync", "PREPARED");

      expect(mockIo.emit).toHaveBeenCalledWith("matrix:status", {
        status: "connected",
        userId: "@bot:example.com",
      });
    });

    it("stops previous client when starting a new one", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok1");
      await bridge.start("https://matrix.example.com", "tok2");

      expect(mockStopClient).toHaveBeenCalledTimes(1);
    });

    it("emits matrix:status disconnected on stop", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");
      await bridge.stop();

      expect(mockStopClient).toHaveBeenCalled();
      expect(mockIo.emit).toHaveBeenCalledWith("matrix:status", {
        status: "disconnected",
      });
    });
  });

  describe("receiving messages", () => {
    it("routes a text message from a paired user to the bus", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      // Pair the user
      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));

      const busSendSpy = vi.spyOn(bus, "send");

      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!room1:example.com",
        content: { msgtype: "m.text", body: "Hello Otterbot!" },
      });

      // Simulate timeline event
      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });

      // Allow async handlers to run
      await new Promise((r) => setTimeout(r, 50));

      expect(busSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          toAgentId: "coo",
          type: MessageType.Chat,
          content: "Hello Otterbot!",
          metadata: expect.objectContaining({
            source: "matrix",
            matrixUserId: userId,
            matrixRoomId: "!room1:example.com",
          }),
        }),
      );
    });

    it("sends a pairing code to unpaired users", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const event = makeMatrixEvent({
        sender: "@stranger:example.com",
        roomId: "!room1:example.com",
        content: { msgtype: "m.text", body: "Hello" },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockSendMessage).toHaveBeenCalledWith(
        "!room1:example.com",
        expect.objectContaining({
          msgtype: "m.text",
          body: expect.stringContaining("pair"),
        }),
      );
      expect(mockIo.emit).toHaveBeenCalledWith(
        "matrix:pairing-request",
        expect.objectContaining({
          matrixUserId: "@stranger:example.com",
        }),
      );
    });

    it("ignores messages from the bot itself", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const busSendSpy = vi.spyOn(bus, "send");

      const event = makeMatrixEvent({
        sender: "@bot:example.com", // same as mockGetUserId
        roomId: "!room1:example.com",
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(busSendSpy).not.toHaveBeenCalled();
    });

    it("ignores non-message events", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const busSendSpy = vi.spyOn(bus, "send");

      const event = makeMatrixEvent({
        type: "m.room.member",
        sender: "@user:example.com",
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(busSendSpy).not.toHaveBeenCalled();
    });

    it("respects room allowlist", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));
      configStore.set("matrix:allowed_rooms", JSON.stringify(["!allowed:example.com"]));

      const busSendSpy = vi.spyOn(bus, "send");

      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!forbidden:example.com",
        content: { msgtype: "m.text", body: "Hello" },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!forbidden:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(busSendSpy).not.toHaveBeenCalled();
    });

    it("handles media messages with a description", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));

      const busSendSpy = vi.spyOn(bus, "send");

      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!room1:example.com",
        content: {
          msgtype: "m.image",
          body: "photo.jpg",
          url: "mxc://example.com/abc123",
        },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(busSendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("photo.jpg"),
        }),
      );
    });
  });

  describe("sending messages", () => {
    it("sends COO response back to Matrix room", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));

      // Trigger an inbound message to create conversation mapping
      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!room1:example.com",
        content: { msgtype: "m.text", body: "What is 2+2?" },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      // Get the conversationId that was created
      const busSendSpy = vi.spyOn(bus, "send");
      const lastCall = busSendSpy.mock.calls[0];
      // The bus.send was called from the bridge itself; find the conversationId from mockCoo
      const conversationId = mockCoo.startNewConversation.mock.calls[0]?.[0];
      expect(conversationId).toBeTruthy();

      // Simulate COO responding via broadcast
      const response: BusMessage = {
        id: "msg-resp",
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "The answer is 4.",
        metadata: {},
        conversationId,
        timestamp: new Date().toISOString(),
      };

      // Get the broadcast handler that was registered
      // bus.onBroadcast was called during start(), so broadcast it
      mockSendMessage.mockClear();

      // Manually broadcast the message through the bus
      bus.send({
        fromAgentId: "coo",
        toAgentId: null,
        type: MessageType.Chat,
        content: "The answer is 4.",
        conversationId,
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockSendMessage).toHaveBeenCalledWith(
        "!room1:example.com",
        expect.objectContaining({
          msgtype: "m.text",
          body: "The answer is 4.",
        }),
      );
    });

    it("sends typing indicator when receiving a message", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));

      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!room1:example.com",
        content: { msgtype: "m.text", body: "Working on something..." },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockSendTyping).toHaveBeenCalledWith("!room1:example.com", true, 30_000);
    });

    it("creates a new conversation for new user/room pairs", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const userId = "@user:example.com";
      configStore.set(`matrix:paired:${userId}`, JSON.stringify({
        matrixUserId: userId,
        pairedAt: new Date().toISOString(),
      }));

      const event = makeMatrixEvent({
        sender: userId,
        roomId: "!room1:example.com",
        content: { msgtype: "m.text", body: "First message" },
      });

      await emitClientEvent("Room.timeline", event, { roomId: "!room1:example.com" });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCoo.startNewConversation).toHaveBeenCalledTimes(1);
      expect(mockIo.emit).toHaveBeenCalledWith(
        "conversation:created",
        expect.objectContaining({
          title: expect.stringContaining("Matrix:"),
        }),
      );
    });
  });

  describe("getJoinedRooms", () => {
    it("returns empty array when client is not started", async () => {
      const bridge = await createBridge();
      expect(bridge.getJoinedRooms()).toEqual([]);
    });

    it("returns rooms from the client", async () => {
      mockGetRooms.mockReturnValue([
        { roomId: "!room1:example.com", name: "General" },
        { roomId: "!room2:example.com", name: "Random" },
      ]);

      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const rooms = bridge.getJoinedRooms();
      expect(rooms).toHaveLength(2);
      expect(rooms[0]).toEqual({ id: "!room1:example.com", name: "General" });
    });
  });

  describe("media support", () => {
    it("uploads and sends media messages", async () => {
      const bridge = await createBridge();
      await bridge.start("https://matrix.example.com", "tok");

      const buffer = Buffer.from("fake image data");
      await bridge.sendMediaMessage("!room1:example.com", buffer, "test.png", "image/png");

      expect(mockUploadContent).toHaveBeenCalledWith(buffer, {
        name: "test.png",
        type: "image/png",
      });
      expect(mockSendMessage).toHaveBeenCalledWith(
        "!room1:example.com",
        expect.objectContaining({
          msgtype: "m.image",
          body: "test.png",
          url: "mxc://example.com/file1",
          info: { mimetype: "image/png", size: buffer.length },
        }),
      );
    });

    it("returns null when client is not started", async () => {
      const bridge = await createBridge();
      const result = await bridge.sendMediaMessage(
        "!room1:example.com",
        Buffer.from("data"),
        "file.txt",
        "text/plain",
      );
      expect(result).toBeNull();
    });
  });
});
