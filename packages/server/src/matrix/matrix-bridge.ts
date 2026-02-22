import {
  createClient,
  ClientEvent,
  RoomEvent,
  EventType,
  MsgType,
  type MatrixClient,
  type Room,
  type MatrixEvent,
  type ISendEventResponse,
} from "matrix-js-sdk";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";
import { isPaired, generatePairingCode } from "./pairing.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Matrix Bridge
// ---------------------------------------------------------------------------

const MATRIX_MAX_LENGTH = 40_000; // Matrix allows ~65K but we keep it sensible

interface PendingResponse {
  roomId: string;
  conversationId: string;
  replyToEventId?: string;
}

export class MatrixBridge {
  private client: MatrixClient | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{matrixUserId}:{roomId}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → roomId (for sending unsolicited messages) */
  private roomMap = new Map<string, string>();

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(homeserverUrl: string, accessToken: string): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    this.client = createClient({
      baseUrl: homeserverUrl,
      accessToken,
      userId: getConfig("matrix:user_id") ?? undefined,
    });

    this.client.on(ClientEvent.Sync, (state: string) => {
      if (state === "PREPARED") {
        const userId = this.client?.getUserId() ?? null;
        console.log(`[Matrix] Synced as ${userId}`);
        this.io.emit("matrix:status", {
          status: "connected",
          userId: userId ?? undefined,
        });
      }
    });

    this.client.on(RoomEvent.Timeline, (event: MatrixEvent, room: Room | undefined) => {
      this.handleTimelineEvent(event, room).catch((err) => {
        console.error("[Matrix] Error handling timeline event:", err);
      });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    await this.client.startClient({ initialSyncLimit: 0 });
  }

  async stop(): Promise<void> {
    this.pendingResponses.clear();

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Stop client
    if (this.client) {
      this.client.stopClient();
      this.client = null;
      this.io.emit("matrix:status", { status: "disconnected" });
    }
  }

  getJoinedRooms(): Array<{ id: string; name: string }> {
    if (!this.client) return [];
    const rooms = this.client.getRooms();
    return rooms.map((r) => ({
      id: r.roomId,
      name: r.name || r.roomId,
    }));
  }

  // -------------------------------------------------------------------------
  // Inbound: Matrix → COO
  // -------------------------------------------------------------------------

  private async handleTimelineEvent(event: MatrixEvent, room: Room | undefined): Promise<void> {
    // Only handle room messages
    if (event.getType() !== EventType.RoomMessage) return;

    const senderId = event.getSender();
    if (!senderId) return;

    // Ignore our own messages
    if (senderId === this.client?.getUserId()) return;

    const roomId = event.getRoomId();
    if (!roomId) return;

    const content = event.getContent();
    const msgtype = content.msgtype;

    // Room allowlist: if set, only respond in allowed rooms
    const rawAllowed = getConfig("matrix:allowed_rooms");
    if (rawAllowed) {
      try {
        const allowed: string[] = JSON.parse(rawAllowed);
        if (allowed.length > 0 && !allowed.includes(roomId)) {
          return;
        }
      } catch { /* ignore parse errors */ }
    }

    // Check pairing
    if (!isPaired(senderId)) {
      const code = generatePairingCode(senderId);
      await this.sendTextMessage(
        roomId,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n**\`${code}\`**\n\nThis code expires in 1 hour.`,
      );
      this.io.emit("matrix:pairing-request", {
        code,
        matrixUserId: senderId,
      });
      return;
    }

    // Handle text messages
    if (msgtype === MsgType.Text || msgtype === MsgType.Notice || msgtype === MsgType.Emote) {
      const text = content.body as string;
      if (!text) return;
      await this.routeToCOO(roomId, senderId, text, event.getId());
      return;
    }

    // Handle media messages (image, video, audio, file)
    if (msgtype === MsgType.Image || msgtype === MsgType.Video || msgtype === MsgType.Audio || msgtype === MsgType.File) {
      const url = content.url as string | undefined;
      const filename = content.body as string;
      const description = `[${msgtype} attachment: ${filename}${url ? ` — ${url}` : ""}]`;
      await this.routeToCOO(roomId, senderId, description, event.getId());
      return;
    }
  }

  private async routeToCOO(
    roomId: string,
    matrixUserId: string,
    content: string,
    eventId?: string,
  ): Promise<void> {
    const convKey = `${matrixUserId}:${roomId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      // Create a new conversation for this Matrix thread
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Matrix: ${matrixUserId} — ${content.slice(0, 60)}`;
      const conversation: Conversation = {
        id: conversationId,
        title,
        projectId: null,
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.conversations).values(conversation).run();
      this.coo.startNewConversation(conversationId, null, null);
      this.io.emit("conversation:created", conversation);
      this.conversationMap.set(convKey, conversationId);
    } else {
      // Update timestamp
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Track room for outbound messages
    this.roomMap.set(conversationId, roomId);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      roomId,
      conversationId,
      replyToEventId: eventId,
    });

    // Send typing indicator
    if (this.client) {
      this.client.sendTyping(roomId, true, 30_000).catch(() => { /* ignore */ });
    }

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // CEO-equivalent (external user)
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "matrix",
        matrixUserId,
        matrixRoomId: roomId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Matrix
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        this.pendingResponses.delete(conversationId);

        // Stop typing indicator
        if (this.client) {
          this.client.sendTyping(pending.roomId, false, 0).catch(() => { /* ignore */ });
        }

        this.sendTextMessage(pending.roomId, message.content).catch((err) => {
          console.error("[Matrix] Error sending reply:", err);
        });
        return;
      }

      // Unsolicited message to a known Matrix room
      const roomId = this.roomMap.get(conversationId);
      if (roomId) {
        this.sendTextMessage(roomId, message.content).catch((err) => {
          console.error("[Matrix] Error sending unsolicited message:", err);
        });
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Media support
  // -------------------------------------------------------------------------

  async sendMediaMessage(
    roomId: string,
    buffer: Buffer,
    filename: string,
    mimetype: string,
  ): Promise<ISendEventResponse | null> {
    if (!this.client) return null;

    const upload = await this.client.uploadContent(buffer, {
      name: filename,
      type: mimetype,
    });

    const msgtype = mimetype.startsWith("image/")
      ? MsgType.Image
      : mimetype.startsWith("video/")
        ? MsgType.Video
        : mimetype.startsWith("audio/")
          ? MsgType.Audio
          : MsgType.File;

    return this.client.sendMessage(roomId, {
      msgtype,
      body: filename,
      url: upload.content_uri,
      info: { mimetype, size: buffer.length },
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async sendTextMessage(roomId: string, text: string): Promise<void> {
    if (!this.client) return;

    const chunks = splitMessage(text, MATRIX_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.client.sendMessage(roomId, {
        msgtype: MsgType.Text,
        body: chunk,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Message splitting
// ---------------------------------------------------------------------------

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try to split at paragraph boundary
    const paragraphIdx = remaining.lastIndexOf("\n\n", maxLength);
    if (paragraphIdx > maxLength * 0.3) {
      splitIdx = paragraphIdx;
    }

    // Try sentence boundary
    if (splitIdx === -1) {
      const sentenceMatch = remaining.slice(0, maxLength).match(/.*[.!?]\s/s);
      if (sentenceMatch) {
        splitIdx = sentenceMatch[0].length;
      }
    }

    // Hard cut at newline
    if (splitIdx === -1) {
      const newlineIdx = remaining.lastIndexOf("\n", maxLength);
      if (newlineIdx > maxLength * 0.3) {
        splitIdx = newlineIdx;
      }
    }

    // Final fallback: hard cut
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}
