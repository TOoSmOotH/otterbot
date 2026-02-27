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
// Signal Bridge — communicates with signal-cli via JSON-RPC over HTTP
// ---------------------------------------------------------------------------

const SIGNAL_MAX_LENGTH = 4_000; // Signal messages can be up to ~8K but keep it reasonable
const POLL_INTERVAL_MS = 2_000; // Poll for new messages every 2 seconds

interface PendingResponse {
  recipientNumber: string;
  conversationId: string;
}

/** Shape of a message envelope returned by signal-cli receive. */
interface SignalEnvelope {
  sourceNumber?: string;
  sourceName?: string;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    groupInfo?: { groupId: string };
    attachments?: Array<{
      contentType: string;
      filename?: string;
      id: string;
    }>;
  };
}

export class SignalBridge {
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private pendingResponses = new Map<string, PendingResponse>();
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{signalNumber}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → signalNumber (for sending unsolicited messages) */
  private numberMap = new Map<string, string>();

  private apiUrl: string | null = null;
  private phoneNumber: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: { apiUrl: string; phoneNumber: string }): Promise<void> {
    if (this.running) {
      await this.stop();
    }

    this.apiUrl = config.apiUrl.replace(/\/+$/, "");
    this.phoneNumber = config.phoneNumber;

    // Verify connectivity
    try {
      const res = await fetch(`${this.apiUrl}/api/v1/accounts`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`signal-cli API returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.error("[Signal] Cannot reach signal-cli API:", err);
      this.io.emit("signal:status", { status: "error" });
      throw err;
    }

    this.running = true;

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);

    // Start polling for incoming messages
    this.pollTimer = setInterval(() => {
      this.pollMessages().catch((err) => {
        console.error("[Signal] Poll error:", err);
      });
    }, POLL_INTERVAL_MS);

    console.log(`[Signal] Bridge started for ${this.phoneNumber}`);
    this.io.emit("signal:status", { status: "connected", phoneNumber: this.phoneNumber });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pendingResponses.clear();

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    this.apiUrl = null;
    this.phoneNumber = null;
    this.io.emit("signal:status", { status: "disconnected" });
  }

  // -------------------------------------------------------------------------
  // Inbound: Signal → COO
  // -------------------------------------------------------------------------

  private async pollMessages(): Promise<void> {
    if (!this.apiUrl || !this.phoneNumber || !this.running) return;

    let envelopes: SignalEnvelope[];
    try {
      const res = await fetch(
        `${this.apiUrl}/api/v1/receive/${encodeURIComponent(this.phoneNumber)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return;
      envelopes = (await res.json()) as SignalEnvelope[];
    } catch {
      return; // Silently ignore transient errors
    }

    for (const envelope of envelopes) {
      await this.handleEnvelope(envelope);
    }
  }

  private async handleEnvelope(envelope: SignalEnvelope): Promise<void> {
    const senderNumber = envelope.sourceNumber;
    if (!senderNumber) return;

    // Ignore our own messages
    if (senderNumber === this.phoneNumber) return;

    const data = envelope.dataMessage;
    if (!data) return;

    // Skip group messages — only handle direct messages
    if (data.groupInfo) return;

    // Check pairing
    if (!isPaired(senderNumber)) {
      const code = generatePairingCode(senderNumber);
      await this.sendTextMessage(
        senderNumber,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard:\n\n*${code}*\n\nThis code expires in 1 hour.`,
      );
      this.io.emit("signal:pairing-request", {
        code,
        signalNumber: senderNumber,
      });
      return;
    }

    // Handle text messages
    if (data.message) {
      await this.routeToCOO(senderNumber, data.message);
      return;
    }

    // Handle attachments
    if (data.attachments && data.attachments.length > 0) {
      const descriptions = data.attachments.map(
        (a) => `[attachment: ${a.filename ?? a.contentType} (${a.contentType})]`,
      );
      await this.routeToCOO(senderNumber, descriptions.join("\n"));
    }
  }

  private async routeToCOO(signalNumber: string, content: string): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(signalNumber);

    if (!conversationId) {
      // Create a new conversation for this Signal user
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Signal: ${signalNumber} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(signalNumber, conversationId);
    } else {
      // Update timestamp
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    // Track number for outbound messages
    this.numberMap.set(conversationId, signalNumber);

    // Track pending response
    this.pendingResponses.set(conversationId, {
      recipientNumber: signalNumber,
      conversationId,
    });

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null, // CEO-equivalent (external user)
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "signal",
        signalNumber,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Signal
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    // Only care about COO → CEO (null) responses
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;

    if (conversationId) {
      const pending = this.pendingResponses.get(conversationId);
      if (pending) {
        this.pendingResponses.delete(conversationId);
        this.sendTextMessage(pending.recipientNumber, message.content).catch((err) => {
          console.error("[Signal] Error sending reply:", err);
        });
        return;
      }

      // Unsolicited message to a known Signal number
      const number = this.numberMap.get(conversationId);
      if (number) {
        this.sendTextMessage(number, message.content).catch((err) => {
          console.error("[Signal] Error sending unsolicited message:", err);
        });
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async sendTextMessage(recipientNumber: string, text: string): Promise<void> {
    if (!this.apiUrl || !this.phoneNumber) return;

    const chunks = splitMessage(text, SIGNAL_MAX_LENGTH);
    for (const chunk of chunks) {
      try {
        await fetch(
          `${this.apiUrl}/api/v1/send/${encodeURIComponent(this.phoneNumber)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              recipients: [recipientNumber],
              message: chunk,
            }),
            signal: AbortSignal.timeout(10_000),
          },
        );
      } catch (err) {
        console.error("[Signal] Failed to send message:", err);
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
