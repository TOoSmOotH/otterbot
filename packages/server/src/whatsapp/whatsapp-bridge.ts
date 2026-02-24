import type WAWebJS from "whatsapp-web.js";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// WhatsApp Bridge
// ---------------------------------------------------------------------------

const WHATSAPP_MAX_LENGTH = 4096; // WhatsApp message character limit

export interface WhatsAppConfig {
  /** Directory to store WhatsApp session data for LocalAuth. */
  dataPath: string;
  /** Phone numbers allowed to interact with the bot (E.164 format without +). Empty = allow all. */
  allowedNumbers: string[];
}

export class WhatsAppBridge {
  private client: Client | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{remoteJid}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → chat ID (for sending responses) */
  private chatMap = new Map<string, string>();
  private config: WhatsAppConfig | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: WhatsAppConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    this.config = config;

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: config.dataPath }),
      puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
    });

    this.client.on("qr", (qr: string) => {
      console.log("[WhatsApp] QR code received, scan to authenticate");
      this.io.emit("whatsapp:status", { status: "qr", qr });
    });

    this.client.on("authenticated", () => {
      console.log("[WhatsApp] Authenticated");
      this.io.emit("whatsapp:status", { status: "authenticated" });
    });

    this.client.on("ready", () => {
      console.log("[WhatsApp] Client is ready");
      this.io.emit("whatsapp:status", { status: "connected" });
    });

    this.client.on("message", (message: WAWebJS.Message) => {
      this.handleMessage(message).catch((err) => {
        console.error("[WhatsApp] Error handling message:", err);
      });
    });

    this.client.on("auth_failure", (msg: string) => {
      console.error("[WhatsApp] Authentication failure:", msg);
      this.io.emit("whatsapp:status", { status: "auth_failure" });
    });

    this.client.on("disconnected", (reason: string) => {
      console.log("[WhatsApp] Disconnected:", reason);
      this.io.emit("whatsapp:status", { status: "disconnected" });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    await this.client.initialize();
  }

  async stop(): Promise<void> {
    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Disconnect client
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      this.client = null;
      this.io.emit("whatsapp:status", { status: "disconnected" });
    }

    this.config = null;
  }

  // -------------------------------------------------------------------------
  // Inbound: WhatsApp → COO
  // -------------------------------------------------------------------------

  private async handleMessage(message: WAWebJS.Message): Promise<void> {
    // Ignore messages from self
    if (message.fromMe) return;

    // Ignore non-text messages
    if (message.type !== "chat") return;

    const content = message.body?.trim();
    if (!content) return;

    const chatId = message.from;

    // Extract phone number from JID (format: number@c.us or number@g.us)
    const phoneNumber = chatId.split("@")[0];
    if (!phoneNumber) return;

    // Check allowlist
    if (
      this.config?.allowedNumbers &&
      this.config.allowedNumbers.length > 0 &&
      !this.config.allowedNumbers.includes(phoneNumber)
    ) {
      return;
    }

    const isGroup = chatId.endsWith("@g.us");

    await this.routeToCOO(phoneNumber, chatId, content, isGroup);
  }

  private async routeToCOO(
    phoneNumber: string,
    chatId: string,
    content: string,
    isGroup: boolean,
  ): Promise<void> {
    const convKey = chatId;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const label = isGroup ? `group ${chatId}` : phoneNumber;
      const title = `WhatsApp: ${label} — ${content.slice(0, 60)}`;
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
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    this.chatMap.set(conversationId, chatId);

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "whatsapp",
        whatsappPhone: phoneNumber,
        whatsappChatId: chatId,
        whatsappIsGroup: isGroup,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → WhatsApp
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const chatId = this.chatMap.get(conversationId);
    if (!chatId || !this.client) return;

    this.sendWhatsAppMessage(chatId, message.content);
  }

  private sendWhatsAppMessage(chatId: string, content: string): void {
    if (!this.client) return;

    const chunks = splitMessage(content, WHATSAPP_MAX_LENGTH);
    for (const chunk of chunks) {
      this.client.sendMessage(chatId, chunk).catch((err) => {
        console.error("[WhatsApp] Failed to send message:", err);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let splitIdx = -1;

    // Try newline boundary
    const newlineIdx = remaining.lastIndexOf("\n", maxLength);
    if (newlineIdx > maxLength * 0.3) {
      splitIdx = newlineIdx;
    }

    // Try space boundary
    if (splitIdx === -1) {
      const spaceIdx = remaining.lastIndexOf(" ", maxLength);
      if (spaceIdx > maxLength * 0.3) {
        splitIdx = spaceIdx;
      }
    }

    // Hard cut
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
