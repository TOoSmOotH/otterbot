import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { setConfig } from "../auth/auth.js";
import { isPaired, generatePairingCode, listPairedUsers } from "./pairing.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// WhatsApp Bridge
// ---------------------------------------------------------------------------

const WHATSAPP_MAX_LENGTH = 4096;

interface PendingResponse {
  jid: string;
  conversationId: string;
}

export class WhatsAppBridge {
  private socket: WASocket | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{jid}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → jid (for sending outbound messages) */
  private jidMap = new Map<string, string>();

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(authStatePath: string): Promise<void> {
    if (this.socket) {
      await this.stop();
    }

    const { state, saveCreds } = await useMultiFileAuthState(authStatePath);

    this.socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    });

    // Save credentials on update
    this.socket.ev.on("creds.update", saveCreds);

    // Handle connection updates (QR, connected, disconnected)
    this.socket.ev.on("connection.update", (update) => {
      this.handleConnectionUpdate(update);
    });

    // Handle incoming messages
    this.socket.ev.on("messages.upsert", (upsert) => {
      this.handleMessagesUpsert(upsert).catch((err) => {
        console.error("[WhatsApp] Error handling messages:", err);
      });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);
  }

  async stop(): Promise<void> {
    // Clean up pending responses
    this.pendingResponses.clear();

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Close socket
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
      this.io.emit("whatsapp:status", { status: "disconnected" });
    }
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  private handleConnectionUpdate(update: Partial<BaileysEventMap["connection.update"]>): void {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[WhatsApp] QR code received, emitting to clients");
      this.io.emit("whatsapp:qr", { qr });
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        console.log("[WhatsApp] Logged out — not reconnecting");
        this.io.emit("whatsapp:status", { status: "disconnected" });
      } else {
        console.log("[WhatsApp] Connection closed, status:", statusCode);
        this.io.emit("whatsapp:status", { status: "error" });
      }
    } else if (connection === "open") {
      const phoneNumber = this.socket?.user?.id?.split(":")[0] ?? undefined;
      if (phoneNumber) {
        setConfig("whatsapp:phone_number", phoneNumber);
      }
      console.log(`[WhatsApp] Connected as ${phoneNumber ?? "unknown"}`);
      this.io.emit("whatsapp:status", {
        status: "connected",
        phoneNumber,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Inbound: WhatsApp → COO
  // -------------------------------------------------------------------------

  private async handleMessagesUpsert(
    upsert: BaileysEventMap["messages.upsert"],
  ): Promise<void> {
    if (upsert.type !== "notify") return;

    for (const msg of upsert.messages) {
      // Ignore messages from self
      if (msg.key.fromMe) continue;

      // Only handle text messages
      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text;
      if (!text) continue;

      const jid = msg.key.remoteJid;
      if (!jid) continue;

      // Get sender name
      const pushName = msg.pushName ?? jid.split("@")[0] ?? "Unknown";

      // Check pairing
      if (!isPaired(jid)) {
        const code = generatePairingCode(jid, pushName);
        await this.socket?.sendMessage(jid, {
          text: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*${code}*\n\nThis code expires in 1 hour.`,
        });
        this.io.emit("whatsapp:pairing-request", {
          code,
          whatsappJid: jid,
          whatsappName: pushName,
        });
        return;
      }

      // Route to COO
      await this.routeToCOO(jid, pushName, text);
    }
  }

  private async routeToCOO(
    jid: string,
    pushName: string,
    content: string,
  ): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(jid);

    if (!conversationId) {
      // Create a new conversation
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `WhatsApp: ${pushName} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(jid, conversationId);
      this.jidMap.set(conversationId, jid);
    } else {
      // Update timestamp
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Track pending response
    this.pendingResponses.set(conversationId, {
      jid,
      conversationId,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "whatsapp",
        whatsappJid: jid,
        whatsappPushName: pushName,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → WhatsApp
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        this.pendingResponses.delete(conversationId);
        this.sendWhatsAppMessage(pending.jid, message.content).catch((err) => {
          console.error("[WhatsApp] Error sending reply:", err);
        });
        return;
      }

      // Unsolicited message to a known conversation
      const jid = this.jidMap.get(conversationId);
      if (jid) {
        this.sendWhatsAppMessage(jid, message.content).catch((err) => {
          console.error("[WhatsApp] Error sending unsolicited message:", err);
        });
        return;
      }
    }

    // Fallback: send to first paired user
    const paired = listPairedUsers();
    if (paired.length > 0) {
      this.sendWhatsAppMessage(paired[0]!.whatsappJid, message.content).catch(
        (err) => {
          console.error("[WhatsApp] Error sending DM fallback:", err);
        },
      );
    }
  }

  private async sendWhatsAppMessage(jid: string, content: string): Promise<void> {
    if (!this.socket) return;
    const chunks = splitMessage(content, WHATSAPP_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.socket.sendMessage(jid, { text: chunk });
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
