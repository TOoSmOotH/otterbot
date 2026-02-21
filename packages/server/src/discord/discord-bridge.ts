import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
  type Message as DiscordMessage,
  type TextChannel,
  type DMChannel,
} from "discord.js";
import type { DiscordAvailableChannel } from "./discord-settings.js";
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
// Discord Bridge
// ---------------------------------------------------------------------------

const DISCORD_MAX_LENGTH = 2000;
const TYPING_INTERVAL_MS = 5000;

interface PendingResponse {
  discordMessage: DiscordMessage;
  conversationId: string;
  typingTimer: ReturnType<typeof setInterval>;
}

export class DiscordBridge {
  private client: Client | null = null;
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{discordUserId}:{channelId}` → conversationId */
  private conversationMap = new Map<string, string>();

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(token: string): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel], // needed for DMs
    });

    this.client.on(Events.ClientReady, (c) => {
      console.log(`[Discord] Logged in as ${c.user.tag}`);
      this.io.emit("discord:status", {
        status: "connected",
        botUsername: c.user.tag,
      });
    });

    this.client.on(Events.Error, (error) => {
      console.error("[Discord] Client error:", error);
      this.io.emit("discord:status", { status: "error" });
    });

    this.client.on(Events.MessageCreate, (message) => {
      this.handleMessage(message).catch((err) => {
        console.error("[Discord] Error handling message:", err);
      });
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    await this.client.login(token);
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

    // Destroy client
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.io.emit("discord:status", { status: "disconnected" });
    }
  }

  getAvailableChannels(): DiscordAvailableChannel[] {
    if (!this.client) return [];
    const channels: DiscordAvailableChannel[] = [];
    for (const guild of this.client.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        if (channel.type === ChannelType.GuildText) {
          channels.push({
            id: channel.id,
            name: channel.name,
            guildName: guild.name,
          });
        }
      }
    }
    return channels;
  }

  // -------------------------------------------------------------------------
  // Inbound: Discord → COO
  // -------------------------------------------------------------------------

  private async handleMessage(message: DiscordMessage): Promise<void> {
    // Ignore bots
    if (message.author.bot) return;

    const isDM = message.channel.type === ChannelType.DM;
    const requireMention = getConfig("discord:require_mention") !== "false";

    // In guilds, only respond to @mentions (unless require_mention is off)
    if (!isDM && requireMention) {
      if (!this.client?.user || !message.mentions.has(this.client.user)) {
        return;
      }
    }

    // Channel whitelist: if set, only respond in allowed guild channels (DMs always allowed)
    if (!isDM) {
      const raw = getConfig("discord:allowed_channels");
      if (raw) {
        try {
          const allowed: string[] = JSON.parse(raw);
          if (allowed.length > 0 && !allowed.includes(message.channel.id)) {
            return;
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const discordUserId = message.author.id;
    const discordUsername = message.author.tag ?? message.author.username;

    // Check pairing
    if (!isPaired(discordUserId)) {
      const code = generatePairingCode(discordUserId, discordUsername);
      await message.reply(
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n**\`${code}\`**\n\nThis code expires in 1 hour.`,
      );
      this.io.emit("discord:pairing-request", {
        code,
        discordUserId,
        discordUsername,
      });
      return;
    }

    // Extract content — strip the bot mention if present
    let content = message.content;
    if (this.client?.user) {
      content = content.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "").trim();
    }
    if (!content) return;

    // Route to COO
    await this.routeToCOO(message, discordUserId, content);
  }

  private async routeToCOO(
    discordMessage: DiscordMessage,
    discordUserId: string,
    content: string,
  ): Promise<void> {
    const channelId = discordMessage.channel.id;
    const convKey = `${discordUserId}:${channelId}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      // Create a new conversation for this Discord thread
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Discord: ${discordMessage.author.username} — ${content.slice(0, 60)}`;
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
    const channel = discordMessage.channel as TextChannel | DMChannel;
    const sendTyping = () => {
      channel.sendTyping().catch(() => { /* ignore */ });
    };
    sendTyping();
    const typingTimer = setInterval(sendTyping, TYPING_INTERVAL_MS);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      discordMessage,
      conversationId,
      typingTimer,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // CEO-equivalent (external user)
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "discord",
        discordUserId,
        discordChannelId: channelId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Discord
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const pending = this.pendingResponses.get(conversationId);
    if (!pending) return;

    // Clean up
    clearInterval(pending.typingTimer);
    this.pendingResponses.delete(conversationId);

    // Send reply to Discord
    this.sendDiscordReply(pending.discordMessage, message.content).catch((err) => {
      console.error("[Discord] Error sending reply:", err);
    });
  }

  private async sendDiscordReply(
    originalMessage: DiscordMessage,
    content: string,
  ): Promise<void> {
    const chunks = splitMessage(content, DISCORD_MAX_LENGTH);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) {
        await originalMessage.reply(chunks[i]!);
      } else if ("send" in originalMessage.channel) {
        await originalMessage.channel.send(chunks[i]!);
      }
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
