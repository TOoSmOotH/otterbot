import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk";
import { nanoid } from "nanoid";
import type { AgentMessage } from "@otterbot/shared";
import type { Transport } from "./transport.js";

/** The subset of a Matrix `m.room.message` timeline event we use. */
interface MatrixMessageEvent {
  sender?: string;
  content?: { msgtype?: string; body?: string };
}

/** Escape text for inclusion in an `org.matrix.custom.html` formatted body. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Routes agent-to-agent messages through a shared Matrix room. Each agent's
 * messages post as a notice tagged with the agent and kind, so the swarm's
 * chatter is readable in any Matrix client. Human messages typed in the room
 * are routed to the COO as a request, letting a person talk to the swarm.
 *
 * Requires a homeserver URL, an access token and a room id. The sync token is
 * persisted to `storagePath` so a restart resumes from the last seen event.
 *
 * End-to-end encryption is always enabled via a persistent rust-sdk crypto
 * store in `cryptoStoragePath`: the swarm room can be encrypted and messages
 * are transparently decrypted/encrypted. The crypto store is keyed to the
 * device behind the access token — keep both stable across restarts.
 */
export class MatrixTransport implements Transport {
  readonly id = "matrix" as const;
  private readonly client: MatrixClient;
  private selfUserId = "";
  private receiveHandler: (msg: AgentMessage) => void = () => {};

  constructor(
    homeserverUrl: string,
    accessToken: string,
    private readonly roomId: string,
    storagePath: string,
    cryptoStoragePath: string
  ) {
    mkdirSync(dirname(storagePath), { recursive: true });
    mkdirSync(cryptoStoragePath, { recursive: true });
    this.client = new MatrixClient(
      homeserverUrl,
      accessToken,
      new SimpleFsStorageProvider(storagePath),
      new RustSdkCryptoStorageProvider(cryptoStoragePath)
    );
    AutojoinRoomsMixin.setupOnClient(this.client);
    this.client.on("room.failed_decryption", (roomId: string, _event: unknown, err: unknown) => {
      console.warn(
        `[matrix] transport failed to decrypt an event in ${roomId}:`,
        err instanceof Error ? err.message : err
      );
    });
  }

  async start(): Promise<void> {
    this.selfUserId = await this.client.getUserId();
    this.client.on("room.message", (roomId: string, event: MatrixMessageEvent) =>
      this.onMatrixMessage(roomId, event)
    );
    await this.client.start();
    console.info(`[matrix] transport connected as ${this.selfUserId}`);
  }

  async stop(): Promise<void> {
    this.client.stop();
  }

  async send(msg: AgentMessage): Promise<void> {
    const header = `${msg.from} · ${msg.kind} → ${msg.to ?? "all"}`;
    const body = msg.body || "(no content)";
    try {
      await this.client.sendMessage(this.roomId, {
        msgtype: "m.notice",
        body: `[${header}] ${body}`,
        format: "org.matrix.custom.html",
        formatted_body: `<strong>${escapeHtml(header)}</strong><br/>${escapeHtml(body)}`,
      });
    } catch (err) {
      console.warn("[matrix] send failed:", err);
    }
  }

  onReceive(handler: (msg: AgentMessage) => void): void {
    this.receiveHandler = handler;
  }

  /** A human message in the room becomes a request routed to the COO. */
  private onMatrixMessage(roomId: string, event: MatrixMessageEvent): void {
    if (roomId !== this.roomId) return;
    if (!event.sender || event.sender === this.selfUserId) return;
    if (event.content?.msgtype !== "m.text") return;
    const body = (event.content.body ?? "").trim();
    if (!body) return;
    this.receiveHandler({
      id: nanoid(),
      seq: 0,
      kind: "request",
      from: "matrix-user",
      to: "coo",
      threadId: nanoid(),
      correlationId: null,
      rootSpawnId: null,
      body,
      transport: "matrix",
      createdAt: new Date().toISOString(),
    });
  }
}
