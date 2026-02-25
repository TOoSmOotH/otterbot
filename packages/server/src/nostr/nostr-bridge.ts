import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import WebSocket from "ws";
import type { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "@otterbot/shared";
import { MessageType } from "@otterbot/shared";
import type { BusMessage, Conversation } from "@otterbot/shared";
import { MessageBus } from "../bus/message-bus.js";
import { COO } from "../agents/coo.js";
import { getDb, schema } from "../db/index.js";
import { isPaired, generatePairingCode } from "./pairing.js";
import type { NostrConfig } from "./nostr-settings.js";

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

// ---------------------------------------------------------------------------
// Nostr Bridge
// ---------------------------------------------------------------------------

const NOSTR_MAX_LENGTH = 4000; // Safe limit for Nostr messages

// Nostr event kinds
const KIND_ENCRYPTED_DM = 4; // NIP-04 encrypted direct messages

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface NostrFilter {
  kinds?: number[];
  authors?: string[];
  "#p"?: string[];
  since?: number;
}

/**
 * Minimal Nostr crypto utilities.
 * Uses the Web Crypto API (available in Node 19+) for secp256k1 operations
 * and NIP-04 symmetric encryption.
 */
async function importNostrUtils() {
  // Dynamic import to avoid issues if nostr-tools is not installed
  const nostrTools = await import("nostr-tools");
  return nostrTools;
}

export class NostrBridge {
  private sockets: WebSocket[] = [];
  private bus: MessageBus;
  private coo: COO;
  private io: TypedServer;
  private broadcastHandler: ((message: BusMessage) => void) | null = null;
  /** Map of `{senderPubkey}` → conversationId */
  private conversationMap = new Map<string, string>();
  /** Map of conversationId → senderPubkey (for sending responses) */
  private pubkeyMap = new Map<string, string>();
  private config: NostrConfig | null = null;
  private publicKey: string | null = null;
  private secretKeyBytes: Uint8Array | null = null;
  private nostr: Awaited<ReturnType<typeof importNostrUtils>> | null = null;
  private seenEvents = new Set<string>();
  private subscriptionIds = new Map<WebSocket, string>();

  constructor(deps: { bus: MessageBus; coo: COO; io: TypedServer }) {
    this.bus = deps.bus;
    this.coo = deps.coo;
    this.io = deps.io;
  }

  async start(config: NostrConfig): Promise<void> {
    if (this.sockets.length > 0) {
      await this.stop();
    }

    this.config = config;

    // Import nostr-tools
    this.nostr = await importNostrUtils();

    // Derive keys from hex private key
    this.secretKeyBytes = hexToBytes(config.privateKey);
    this.publicKey = this.nostr.getPublicKey(this.secretKeyBytes);

    console.log(`[Nostr] Our pubkey: ${this.publicKey}`);

    // Connect to relays
    for (const relayUrl of config.relays) {
      this.connectToRelay(relayUrl);
    }

    this.io.emit("nostr:status", {
      status: "connected",
      pubkey: this.publicKey,
    });

    // Subscribe to bus broadcasts to intercept COO responses
    this.broadcastHandler = (message: BusMessage) => {
      this.handleBusMessage(message);
    };
    this.bus.onBroadcast(this.broadcastHandler);
  }

  async stop(): Promise<void> {
    // Unsubscribe from bus
    if (this.broadcastHandler) {
      this.bus.offBroadcast(this.broadcastHandler);
      this.broadcastHandler = null;
    }

    // Close all relay connections
    for (const ws of this.sockets) {
      try {
        ws.close();
      } catch { /* ignore */ }
    }
    this.sockets = [];
    this.subscriptionIds.clear();
    this.seenEvents.clear();

    this.config = null;
    this.publicKey = null;
    this.secretKeyBytes = null;
    this.nostr = null;

    this.io.emit("nostr:status", { status: "disconnected" });
  }

  // -------------------------------------------------------------------------
  // Relay connections
  // -------------------------------------------------------------------------

  private connectToRelay(relayUrl: string): void {
    const ws = new WebSocket(relayUrl);

    ws.on("open", () => {
      console.log(`[Nostr] Connected to relay: ${relayUrl}`);
      this.subscribeToEvents(ws);
    });

    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleRelayMessage(msg, ws).catch((err) => {
          console.error("[Nostr] Error handling relay message:", err);
        });
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => {
      console.log(`[Nostr] Disconnected from relay: ${relayUrl}`);
      this.subscriptionIds.delete(ws);
      const idx = this.sockets.indexOf(ws);
      if (idx !== -1) this.sockets.splice(idx, 1);

      // Reconnect after 5 seconds if still configured
      if (this.config) {
        setTimeout(() => {
          if (this.config && this.config.relays.includes(relayUrl)) {
            this.connectToRelay(relayUrl);
          }
        }, 5000);
      }
    });

    ws.on("error", (err) => {
      console.error(`[Nostr] Relay error (${relayUrl}):`, err.message);
    });

    this.sockets.push(ws);
  }

  private subscribeToEvents(ws: WebSocket): void {
    if (!this.publicKey) return;

    const subId = nanoid(8);
    const filter: NostrFilter = {
      kinds: [KIND_ENCRYPTED_DM],
      "#p": [this.publicKey],
      since: Math.floor(Date.now() / 1000) - 60, // only recent messages
    };

    ws.send(JSON.stringify(["REQ", subId, filter]));
    this.subscriptionIds.set(ws, subId);
  }

  // -------------------------------------------------------------------------
  // Inbound: Nostr → COO
  // -------------------------------------------------------------------------

  private async handleRelayMessage(msg: unknown[], ws: WebSocket): Promise<void> {
    if (!Array.isArray(msg)) return;

    const [type] = msg;

    if (type === "EVENT") {
      const event = msg[2] as NostrEvent;
      if (!event || !event.id) return;

      // Deduplicate across relays
      if (this.seenEvents.has(event.id)) return;
      this.seenEvents.add(event.id);

      // Prune seen events periodically (keep last 1000)
      if (this.seenEvents.size > 1000) {
        const arr = Array.from(this.seenEvents);
        this.seenEvents = new Set(arr.slice(-500));
      }

      await this.handleEvent(event);
    }
  }

  private async handleEvent(event: NostrEvent): Promise<void> {
    if (!this.nostr || !this.secretKeyBytes || !this.publicKey) return;

    // Ignore our own messages
    if (event.pubkey === this.publicKey) return;

    // Only handle encrypted DMs (kind 4)
    if (event.kind !== KIND_ENCRYPTED_DM) return;

    // Verify the event is addressed to us
    const pTag = event.tags.find((t) => t[0] === "p" && t[1] === this.publicKey);
    if (!pTag) return;

    // Decrypt the message (NIP-04)
    let content: string;
    try {
      content = await this.nostr.nip04.decrypt(this.secretKeyBytes, event.pubkey, event.content);
    } catch (err) {
      console.error("[Nostr] Failed to decrypt DM:", err);
      return;
    }

    if (!content.trim()) return;

    const senderPubkey = event.pubkey;
    // Use truncated pubkey as display name
    const displayName = `${senderPubkey.slice(0, 8)}...${senderPubkey.slice(-4)}`;

    // Check pairing
    if (!isPaired(senderPubkey)) {
      const code = generatePairingCode(senderPubkey, displayName);
      await this.sendEncryptedDM(
        senderPubkey,
        `I don't recognize you yet. To pair with me, ask my owner to approve this code in the Otterbot dashboard: ${code} — This code expires in 1 hour.`,
      );
      this.io.emit("nostr:pairing-request", {
        code,
        nostrPubkey: senderPubkey,
        nostrDisplayName: displayName,
      });
      return;
    }

    await this.routeToCOO(senderPubkey, displayName, content.trim());
  }

  private async routeToCOO(
    senderPubkey: string,
    displayName: string,
    content: string,
  ): Promise<void> {
    const db = getDb();
    let conversationId = this.conversationMap.get(senderPubkey);

    if (!conversationId) {
      conversationId = nanoid();
      const now = new Date().toISOString();
      const title = `Nostr: ${displayName} — ${content.slice(0, 60)}`;
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
      this.conversationMap.set(senderPubkey, conversationId);
    } else {
      db.update(schema.conversations)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.conversations.id, conversationId))
        .run();
    }

    this.pubkeyMap.set(conversationId, senderPubkey);

    // Send to COO via bus
    this.bus.send({
      fromAgentId: null,
      toAgentId: "coo",
      type: MessageType.Chat,
      content,
      conversationId,
      metadata: {
        source: "nostr",
        nostrPubkey: senderPubkey,
        nostrDisplayName: displayName,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Outbound: COO → Nostr
  // -------------------------------------------------------------------------

  private handleBusMessage(message: BusMessage): void {
    if (message.fromAgentId !== "coo" || message.toAgentId !== null) return;

    const conversationId = message.conversationId;
    if (!conversationId) return;

    const recipientPubkey = this.pubkeyMap.get(conversationId);
    if (!recipientPubkey) return;

    this.sendNostrMessage(recipientPubkey, message.content);
  }

  private sendNostrMessage(recipientPubkey: string, content: string): void {
    const chunks = splitMessage(content, NOSTR_MAX_LENGTH);
    for (const chunk of chunks) {
      this.sendEncryptedDM(recipientPubkey, chunk).catch((err) => {
        console.error("[Nostr] Failed to send DM:", err);
      });
    }
  }

  private async sendEncryptedDM(recipientPubkey: string, content: string): Promise<void> {
    if (!this.nostr || !this.secretKeyBytes || !this.publicKey) return;

    // Encrypt content (NIP-04)
    const encrypted = await this.nostr.nip04.encrypt(
      this.secretKeyBytes,
      recipientPubkey,
      content,
    );

    // Create and sign the event
    const event = this.nostr.finalizeEvent(
      {
        kind: KIND_ENCRYPTED_DM,
        created_at: Math.floor(Date.now() / 1000),
        tags: [["p", recipientPubkey]],
        content: encrypted,
      },
      this.secretKeyBytes,
    );

    // Publish to all connected relays
    const eventMsg = JSON.stringify(["EVENT", event]);
    for (const ws of this.sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(eventMsg);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  // Strip "nsec" prefix if present — user should provide hex key
  const cleanHex = hex.replace(/^0x/, "");
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

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
