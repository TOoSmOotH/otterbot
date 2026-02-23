import TelegramBot from "node-telegram-bot-api";
import type {
  Message as TelegramMessage,
  SendMessageOptions,
  InlineKeyboardButton,
} from "node-telegram-bot-api";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { isPaired, generatePairingCode, listPairedUsers } from "./pairing.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Telegram Bridge
// ---------------------------------------------------------------------------

const TELEGRAM_MAX_LENGTH = 4096;
const TYPING_INTERVAL_MS = 4000;

interface PendingResponse {
  chatId: number;
  messageId: number;
  conversationId: string;
  typingTimer: ReturnType<typeof setInterval>;
}

export class TelegramBridge {
  private bot: TelegramBot | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{telegramUserId}:{chatId}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → chatId (for sending unsolicited messages) */
  private chatMap = new Map<string, number>();
  /** Cached default chat ID for the first paired user (fallback delivery) */
  private defaultChatId: number | null = null;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(token: string): Promise<void> {
    if (this.bot) {
      await this.stop();
    }

    this.bot = new TelegramBot(token, { polling: true });

    const me = await this.bot.getMe();
    console.log(`[Telegram] Logged in as @${me.username}`);
    this.io.emit("telegram:status", {
      status: "connected",
      botUsername: me.username ?? me.first_name,
    });

    this.bot.on("message", (message) => {
      this.handleMessage(message).catch((err) => {
        console.error("[Telegram] Error handling message:", err);
      });
    });

    this.bot.on("polling_error", (error) => {
      console.error("[Telegram] Polling error:", error);
      this.io.emit("telegram:status", { status: "error" });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);
  }

  async stop(): Promise<void> {
    // Clean up pending responses
    for (const [, pending] of this.pendingResponses) {
      clearInterval(pending.typingTimer);
    }
    this.pendingResponses.clear();

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Clear cached default chat
    this.defaultChatId = null;

    // Stop bot polling
    if (this.bot) {
      await this.bot.stopPolling();
      this.bot = null;
      this.io.emit("telegram:status", { status: "disconnected" });
    }
  }

  // -------------------------------------------------------------------------
  // Public: send media / inline keyboards
  // -------------------------------------------------------------------------

  async sendPhoto(chatId: number, photo: string | Buffer, caption?: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.sendPhoto(chatId, photo, { caption });
  }

  async sendDocument(chatId: number, doc: string | Buffer, caption?: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.sendDocument(chatId, doc, { caption });
  }

  async sendMessageWithKeyboard(
    chatId: number,
    text: string,
    keyboard: InlineKeyboardButton[][],
  ): Promise<void> {
    if (!this.bot) return;
    const opts: SendMessageOptions = {
      reply_markup: { inline_keyboard: keyboard },
    };
    await this.bot.sendMessage(chatId, text, opts);
  }

  // -------------------------------------------------------------------------
  // Inbound: Telegram → COO
  // -------------------------------------------------------------------------

  private async handleMessage(message: TelegramMessage): Promise<void> {
    // Ignore messages without text (stickers, media-only, etc.)
    if (!message.text) return;
    // Ignore messages from bots
    if (message.from?.is_bot) return;

    const telegramUserId = String(message.from!.id);
    const telegramUsername =
      message.from!.username ?? message.from!.first_name ?? "Unknown";
    const chatId = message.chat.id;

    // Check pairing
    if (!isPaired(telegramUserId)) {
      const code = generatePairingCode(telegramUserId, telegramUsername);
      await this.bot!.sendMessage(
        chatId,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*\`${code}\`*\n\nThis code expires in 1 hour.`,
        { parse_mode: "Markdown" },
      );
      this.io.emit("telegram:pairing-request", {
        code,
        telegramUserId,
        telegramUsername,
      });
      return;
    }

    // Handle /start command
    let content = message.text;
    if (content === "/start") {
      await this.bot!.sendMessage(chatId, "Hello! I'm Otterbot. How can I help you?");
      return;
    }

    // Strip bot commands prefix for forwarding (e.g., /ask something → something)
    if (content.startsWith("/")) {
      const spaceIdx = content.indexOf(" ");
      if (spaceIdx === -1) {
        // Command with no arguments — just forward the command name
        content = content.slice(1);
      } else {
        content = content.slice(spaceIdx + 1).trim();
      }
    }

    if (!content) return;

    // Route to COO
    await this.routeToCOO(message, telegramUserId, chatId, content);
  }

  private async routeToCOO(
    telegramMessage: TelegramMessage,
    telegramUserId: string,
    chatId: number,
    content: string,
  ): Promise<void> {
    const convKey = `${telegramUserId}:${chatId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      // Create a new conversation for this Telegram chat
      conversationId = nanoid();
      const now = new Date().toISOString();
      const senderName =
        telegramMessage.from?.username ??
        telegramMessage.from?.first_name ??
        "Unknown";
      const title = `Telegram: ${senderName} — ${content.slice(0, 60)}`;
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

    // Start typing indicator
    this.chatMap.set(conversationId, chatId);
    const sendTyping = () => {
      this.bot?.sendChatAction(chatId, "typing").catch(() => { /* ignore */ });
    };
    sendTyping();
    const typingTimer = setInterval(sendTyping, TYPING_INTERVAL_MS);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      chatId,
      messageId: telegramMessage.message_id,
      conversationId,
      typingTimer,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // External user
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "telegram",
        telegramUserId,
        telegramChatId: String(chatId),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Telegram
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    // Direct reply to a Telegram-originated message
    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        clearInterval(pending.typingTimer);
        this.pendingResponses.delete(conversationId);

        this.sendTelegramReply(pending.chatId, pending.messageId, message.content).catch(
          (err) => {
            console.error("[Telegram] Error sending reply:", err);
          },
        );
        return;
      }

      // Unsolicited message to a known Telegram chat
      const chatId = this.chatMap.get(conversationId);
      if (chatId) {
        this.sendToChat(chatId, message.content).catch((err) => {
          console.error("[Telegram] Error sending unsolicited message:", err);
        });
        return;
      }
    }

    // Fallback: send to first paired user's chat
    const fallbackChatId = this.getDefaultChatId();
    if (fallbackChatId) {
      this.sendToChat(fallbackChatId, message.content).catch((err) => {
        console.error("[Telegram] Error sending DM fallback:", err);
      });
    } else {
      console.warn(
        "[Telegram] DM fallback: no chat available (no paired users or bot not ready)",
      );
    }
  }

  private getDefaultChatId(): number | null {
    if (this.defaultChatId) return this.defaultChatId;
    // We don't have a way to look up Telegram chat IDs for paired users
    // without them messaging first. Return null if no chat is cached.
    return null;
  }

  private async sendTelegramReply(
    chatId: number,
    replyToMessageId: number,
    content: string,
  ): Promise<void> {
    if (!this.bot) return;
    const chunks = splitMessage(content, TELEGRAM_MAX_LENGTH);
    for (let i = 0; i < chunks.length; i++) {
      const opts: SendMessageOptions = {};
      if (i === 0) {
        opts.reply_to_message_id = replyToMessageId;
      }
      await this.bot.sendMessage(chatId, chunks[i]!, opts);
    }
  }

  private async sendToChat(chatId: number, content: string): Promise<void> {
    if (!this.bot) return;
    const chunks = splitMessage(content, TELEGRAM_MAX_LENGTH);
    for (const chunk of chunks) {
      await this.bot.sendMessage(chatId, chunk);
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
