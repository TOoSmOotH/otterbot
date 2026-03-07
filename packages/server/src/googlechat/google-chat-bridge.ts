import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { isPaired, generatePairingCode } from "./pairing.js";

// Google Chat webhook sender — the issuer of the JWT bearer token.
const CHAT_ISSUER = "chat@system.gserviceaccount.com";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// Google Chat messages can be up to 28 KB; use a conservative limit.
const GOOGLE_CHAT_MAX_LENGTH = 4000;

// Polling interval in milliseconds for checking new messages.
const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Google Chat Bridge
// ---------------------------------------------------------------------------

/**
 * Google Chat bridge using the Google Chat API via service account credentials.
 *
 * Google Chat bots can receive messages via:
 * 1. HTTP endpoint (push) — requires a public URL configured in the Chat API console.
 * 2. Pub/Sub subscription — requires a Google Cloud Pub/Sub topic.
 * 3. Polling — using the Chat API spaces.messages.list endpoint.
 *
 * This bridge exposes an HTTP endpoint handler (`handleWebhook`) for the push
 * model, which is the simplest to set up. The bot must be configured as an
 * "HTTP endpoint URL" bot in the Google Chat API console, pointing to
 * `/api/googlechat/webhook`.
 *
 * Authentication: Uses a Google Cloud service account key (JSON) to
 * authenticate outgoing API calls. Incoming webhook events are verified
 * by validating the Bearer token in the Authorization header as a signed
 * JWT issued by `chat@system.gserviceaccount.com`, using the
 * `google-auth-library` OAuth2Client.
 */

export interface GoogleChatConfig {
  serviceAccountKey: Record<string, unknown>;
  /** The Google Cloud project number used as the JWT audience for webhook verification. */
  projectNumber: string;
}

interface PendingResponse {
  spaceName: string;
  conversationId: string;
}

export class GoogleChatBridge {
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{googleChatUserId}:{spaceName}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → space name (for sending replies) */
  private spaceMap = new Map<string, string>();
  private pendingResponses = new Map<string, PendingResponse>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatApi: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private oauth2Client: any = null;
  private expectedAudience: string = "";
  private started = false;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: GoogleChatConfig): Promise<void> {
    if (this.started) {
      await this.stop();
    }

    const { google } = await import("googleapis");

    const auth = new google.auth.GoogleAuth({
      credentials: config.serviceAccountKey,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });

    this.chatApi = google.chat({ version: "v1", auth });

    // Set up JWT verification for incoming webhooks
    const { OAuth2Client } = await import("google-auth-library");
    this.oauth2Client = new OAuth2Client();
    this.expectedAudience = config.projectNumber;

    this.started = true;

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    console.log("[Google Chat] Bridge started");
    this.io.emit("googlechat:status", { status: "connected" });
  }

  async stop(): Promise<void> {
    this.pendingResponses.clear();

    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    this.chatApi = null;
    this.oauth2Client = null;
    this.expectedAudience = "";
    this.started = false;
    this.io.emit("googlechat:status", { status: "disconnected" });
  }

  // -------------------------------------------------------------------------
  // Inbound: Google Chat → COO (via HTTP webhook)
  // -------------------------------------------------------------------------

  /**
   * Verify the Bearer token from the Authorization header.
   * Google Chat sends a signed JWT that must be verified against Google's
   * public keys. The token audience must match the configured project number,
   * and the issuer must be `chat@system.gserviceaccount.com`.
   *
   * @throws if the token is missing, invalid, or does not match expectations.
   */
  async verifyBearerToken(authorizationHeader: string | undefined): Promise<void> {
    if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
      throw new Error("Missing or invalid Authorization header");
    }

    const token = authorizationHeader.slice("Bearer ".length);

    if (!this.oauth2Client) {
      throw new Error("OAuth2 client not initialized");
    }

    const ticket = await this.oauth2Client.verifyIdToken({
      idToken: token,
      audience: this.expectedAudience,
    });

    const payload = ticket.getPayload();
    if (!payload || payload.email !== CHAT_ISSUER) {
      throw new Error("Token issuer is not Google Chat");
    }
  }

  /**
   * Handle an incoming Google Chat webhook event.
   * The server should wire up a POST route at `/api/googlechat/webhook`
   * and pass the parsed request body and the Authorization header here.
   *
   * The Bearer token is verified before processing the event.
   *
   * Google Chat event types:
   * - ADDED_TO_SPACE: Bot added to a space
   * - MESSAGE: New message from a user
   * - REMOVED_FROM_SPACE: Bot removed from a space
   * - CARD_CLICKED: Interactive card action
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleWebhook(event: any, authorizationHeader: string | undefined): Promise<Record<string, unknown> | null> {
    // Verify the Bearer token from Google Chat
    await this.verifyBearerToken(authorizationHeader);
    const eventType: string = event.type;

    if (eventType === "ADDED_TO_SPACE") {
      // Bot was added to a space — send a welcome message
      return { text: "Hello! I'm Otterbot. Send me a message to get started." };
    }

    if (eventType === "REMOVED_FROM_SPACE") {
      // Clean up any state for this space
      return null;
    }

    if (eventType !== "MESSAGE") {
      return null;
    }

    const message = event.message;
    if (!message) return null;

    const content = (message.text as string | undefined)?.trim();
    if (!content) return null;

    const sender = message.sender;
    if (!sender) return null;

    // Skip bot messages to avoid loops
    if (sender.type === "BOT") return null;

    const googleChatUserId: string = sender.name ?? "unknown";
    const googleChatUsername: string = sender.displayName ?? googleChatUserId;
    const spaceName: string = event.space?.name ?? "unknown";

    // Check pairing
    if (!isPaired(googleChatUserId)) {
      const code = generatePairingCode(googleChatUserId, googleChatUsername);
      this.io.emit("googlechat:pairing-request", {
        code,
        googleChatUserId,
        googleChatUsername,
      });
      return {
        text: `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*\`${code}\`*\n\nThis code expires in 1 hour.`,
      };
    }

    await this.routeToCOO(googleChatUserId, googleChatUsername, spaceName, content, message.thread?.name);

    // Return empty object — we'll reply asynchronously via the API
    return {};
  }

  private async routeToCOO(
    googleChatUserId: string,
    googleChatUsername: string,
    spaceName: string,
    content: string,
    threadName?: string,
  ): Promise<void> {
    const convKey = `${googleChatUserId}:${spaceName}`;

    const db = getDb();
    let conversationId = this.conversationMap.get(convKey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Google Chat: ${googleChatUsername} — ${content.slice(0, 60)}`;
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

    // Store space mapping for replies
    this.spaceMap.set(conversationId, spaceName);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      spaceName,
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
        source: "googlechat",
        googleChatUserId,
        googleChatSpaceName: spaceName,
        googleChatThreadName: threadName,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Google Chat
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const spaceName = this.spaceMap.get(conversationId);
    if (!spaceName || !this.chatApi) return;

    this.pendingResponses.delete(conversationId);

    const chunks = splitMessage(message.content, GOOGLE_CHAT_MAX_LENGTH);
    this.sendChunks(spaceName, chunks).catch((err) => {
      console.error("[Google Chat] Error sending reply:", err);
    });
  }

  private async sendChunks(spaceName: string, chunks: string[]): Promise<void> {
    for (const chunk of chunks) {
      await this.chatApi.spaces.messages.create({
        parent: spaceName,
        requestBody: {
          text: chunk,
        },
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
