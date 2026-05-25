import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  OutboundFile,
  RichChatMessage,
} from "./chat-client.js";

/** The subset of a Matrix `m.room.message` timeline event we use. */
interface MatrixMessageEvent {
  sender?: string;
  content?: { msgtype?: string; body?: string };
}

/** Escape text for an `org.matrix.custom.html` formatted body. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Matrix client plumbing for both chat roles. End-to-end encryption is always
 * enabled via a persistent rust-sdk crypto store, so messages in encrypted
 * rooms are transparently decrypted/encrypted. Matrix does not implement
 * in-place edits here, so canEdit = false (no thinking placeholder).
 */
export class MatrixChatClient implements ChatClient {
  readonly canEdit = false;
  private client: MatrixClient | null = null;
  private handler: (m: InboundChatMessage) => void = () => {};
  private selfUserId = "";
  private mentionTokens: string[] = [];

  constructor(
    private readonly homeserverUrl: string,
    private readonly accessToken: string,
    private readonly storagePath: string,
    private readonly cryptoStoragePath: string
  ) {}

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    mkdirSync(dirname(this.storagePath), { recursive: true });
    mkdirSync(this.cryptoStoragePath, { recursive: true });
    const client = new MatrixClient(
      this.homeserverUrl,
      this.accessToken,
      new SimpleFsStorageProvider(this.storagePath),
      new RustSdkCryptoStorageProvider(this.cryptoStoragePath)
    );
    AutojoinRoomsMixin.setupOnClient(client);
    client.on("room.failed_decryption", (roomId: string, _e: unknown, err: unknown) => {
      console.warn(
        `[matrix] failed to decrypt an event in ${roomId}:`,
        err instanceof Error ? err.message : err
      );
    });

    this.selfUserId = await client.getUserId();
    this.mentionTokens = [this.selfUserId.toLowerCase()];
    try {
      const profile = (await client.getUserProfile(this.selfUserId)) as { displayname?: string };
      if (profile?.displayname) this.mentionTokens.push(profile.displayname.toLowerCase());
    } catch {
      // No display name is fine — fall back to mxid matching only.
    }

    client.on("room.message", (roomId: string, event: MatrixMessageEvent) =>
      this.onMatrixMessage(roomId, event)
    );
    await client.start();
    this.client = client;
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = null;
  }

  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    if (!this.client) return null;
    await this.client.sendText(channelId, text.slice(0, 16000) || "(no content)");
    return null;
  }

  // Matrix has no in-place edit here; canEdit is false so this is never called.
  async edit(_handle: MessageHandle, _text: string): Promise<void> {}

  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    if (!this.client) return;
    const header = `${msg.author} · ${msg.kind} → ${msg.to}`;
    const body = msg.body || "(no content)";
    await this.client.sendMessage(channelId, {
      msgtype: "m.notice",
      body: `[${header}] ${body}`,
      format: "org.matrix.custom.html",
      formatted_body: `<strong>${escapeHtml(header)}</strong><br/>${escapeHtml(body)}`,
    });
  }

  async sendFile(channelId: string, file: OutboundFile): Promise<void> {
    if (!this.client) return;
    const url = await this.client.uploadContent(file.data, file.mimeType, file.filename);
    const msgtype = file.mimeType.startsWith("image/") ? "m.image" : "m.file";
    await this.client.sendMessage(channelId, {
      msgtype,
      url,
      body: file.filename,
      info: { mimetype: file.mimeType, size: file.data.length },
    });
  }

  private onMatrixMessage(roomId: string, event: MatrixMessageEvent): void {
    if (event.content?.msgtype !== "m.text") return;
    const text = (event.content.body ?? "").trim();
    const lower = text.toLowerCase();
    this.handler({
      channelId: roomId,
      senderId: event.sender ?? "",
      text,
      fromSelf: !event.sender || event.sender === this.selfUserId,
      mentioned: this.mentionTokens.some((t) => lower.includes(t)),
    });
  }
}
