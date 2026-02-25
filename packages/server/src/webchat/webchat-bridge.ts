import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { isPaired, generatePairingCode } from "./pairing.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// WebChat Bridge
// ---------------------------------------------------------------------------

export class WebchatBridge {
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `webchatUserId` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → Set of socket IDs for that user */
  private socketMap = new Map<string, Set<string>>();
  /** Map of socket ID → webchatUserId */
  private socketUserMap = new Map<string, string>();
  private started = false;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(): Promise<void> {
    if (this.started) {
      await this.stop();
    }

    this.started = true;
    console.log("[WebChat] Bridge started");

    // Listen for webchat messages from Socket.IO clients
    this.io.on("connection", this.handleConnection);

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    this.io.emit("webchat:status", { status: "connected" });
  }

  async stop(): Promise<void> {
    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    this.io.removeListener("connection", this.handleConnection);

    this.started = false;
    this.conversationMap.clear();
    this.socketMap.clear();
    this.socketUserMap.clear();

    this.io.emit("webchat:status", { status: "disconnected" });
    console.log("[WebChat] Bridge stopped");
  }

  // -------------------------------------------------------------------------
  // Socket.IO connection handling
  // -------------------------------------------------------------------------

  private handleConnection = (socket: Socket) => {
    if (!this.started) return;

    socket.on("webchat:join", (data: { userId: string; username: string }, callback?: (ack: { ok: boolean; error?: string }) => void) => {
      this.handleJoin(socket, data.userId, data.username, callback);
    });

    socket.on("webchat:message", (data: { userId: string; content: string }, callback?: (ack: { ok: boolean; error?: string }) => void) => {
      this.handleIncomingMessage(socket, data.userId, data.content, callback);
    });

    socket.on("disconnect", () => {
      this.handleDisconnect(socket);
    });
  };

  private handleJoin(
    socket: Socket,
    userId: string,
    username: string,
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ): void {
    if (!this.started) {
      callback?.({ ok: false, error: "WebChat bridge is not running" });
      return;
    }

    // Track socket → user mapping
    this.socketUserMap.set(socket.id, userId);

    // Join a room for this user so we can target responses
    const room = `webchat:${userId}`;
    socket.join(room);

    // Track sockets per conversation
    const convId = this.conversationMap.get(userId);
    if (convId) {
      const sockets = this.socketMap.get(convId) ?? new Set();
      sockets.add(socket.id);
      this.socketMap.set(convId, sockets);
    }

    callback?.({ ok: true });
  }

  private async handleIncomingMessage(
    socket: Socket,
    userId: string,
    content: string,
    callback?: (ack: { ok: boolean; error?: string }) => void,
  ): Promise<void> {
    if (!this.started) {
      callback?.({ ok: false, error: "WebChat bridge is not running" });
      return;
    }

    if (!content?.trim()) {
      callback?.({ ok: false, error: "Empty message" });
      return;
    }

    const username = userId; // WebChat uses userId as display name

    // Check pairing
    if (!isPaired(userId)) {
      const code = generatePairingCode(userId, username);
      // Send pairing message back to the user
      this.io.to(`webchat:${userId}`).emit("webchat:response", {
        content: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard: ${code} — This code expires in 1 hour.`,
        conversationId: null,
      });
      this.io.emit("webchat:pairing-request", {
        code,
        webchatUserId: userId,
        webchatUsername: username,
      });
      callback?.({ ok: true });
      return;
    }

    await this.routeToCOO(userId, username, content.trim());
    callback?.({ ok: true });
  }

  private handleDisconnect(socket: Socket): void {
    const userId = this.socketUserMap.get(socket.id);
    if (userId) {
      this.socketUserMap.delete(socket.id);
      const convId = this.conversationMap.get(userId);
      if (convId) {
        const sockets = this.socketMap.get(convId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.socketMap.delete(convId);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: WebChat → COO
  // -------------------------------------------------------------------------

  private async routeToCOO(
    userId: string,
    username: string,
    content: string,
  ): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(userId);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `WebChat: ${username} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(userId, conversationId);
    } else {
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "webchat",
        webchatUserId: userId,
        webchatUsername: username,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → WebChat
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    // Find the webchat user for this conversation
    let targetUserId: string | null = null;
    for (const [userId, convId] of this.conversationMap.entries()) {
      if (convId === conversationId) {
        targetUserId = userId;
        break;
      }
    }

    if (!targetUserId) return;

    // Send response to all sockets in this user's room
    this.io.to(`webchat:${targetUserId}`).emit("webchat:response", {
      content: message.content,
      conversationId,
    });
  }
}
