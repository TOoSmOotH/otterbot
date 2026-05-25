import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  MatrixClient,
  SimpleFsStorageProvider,
  RustSdkCryptoStorageProvider,
  AutojoinRoomsMixin,
} from "matrix-bot-sdk";
import type { ChannelBotConfig } from "@otterbot/shared";
import type { AgentRuntime } from "../runtime/agent-runtime.js";
import { ChannelConnector } from "./channel-connector.js";

/** The subset of a Matrix `m.room.message` timeline event we use. */
interface MatrixMessageEvent {
  sender?: string;
  event_id?: string;
  content?: { msgtype?: string; body?: string };
}

/**
 * Connects one agent to a Matrix room with its own client. Inbound room
 * messages run an agent turn (gated by `publicBot` / `allowedUserIds`) and the
 * reply is posted back to the room.
 *
 * Reads `MATRIX_HOMESERVER_URL` and `MATRIX_ACCESS_TOKEN` from the agent's
 * encrypted credentials. The room id is the connector's `channelId`
 * (`!room:server`). The bot auto-joins rooms it is invited to.
 *
 * The sync token is persisted to `storagePath` so a restart resumes from the
 * last seen event instead of replaying the room's backlog.
 *
 * End-to-end encryption is always enabled: a persistent rust-sdk crypto store
 * lives in `cryptoStoragePath`, so the bot transparently decrypts inbound and
 * encrypts outbound messages in encrypted rooms (and works as-is in
 * unencrypted rooms). The crypto store is keyed to the device behind the access
 * token — keep both stable across restarts so the bot can keep decrypting.
 */
export class MatrixConnector extends ChannelConnector {
  private client: MatrixClient | null = null;
  /** This bot's own mxid — set on start; used to skip its own echoes. */
  private selfUserId = "";
  /** Lower-cased mxid + display name, for `mentionOnly` matching. */
  private mentionTokens: string[] = [];

  constructor(
    agentId: string,
    cfg: ChannelBotConfig,
    private readonly homeserverUrl: string,
    private readonly accessToken: string,
    private readonly storagePath: string,
    private readonly cryptoStoragePath: string,
    getRuntime: () => AgentRuntime | undefined
  ) {
    super("matrix", agentId, cfg, getRuntime);
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
    client.on("room.failed_decryption", (roomId: string, _event: unknown, err: unknown) => {
      console.warn(
        `[matrix] connector failed to decrypt an event in ${roomId} for ${this.agentId}:`,
        err instanceof Error ? err.message : err
      );
    });

    this.selfUserId = await client.getUserId();
    this.mentionTokens = [this.selfUserId.toLowerCase()];
    try {
      const profile = (await client.getUserProfile(this.selfUserId)) as {
        displayname?: string;
      };
      if (profile?.displayname) this.mentionTokens.push(profile.displayname.toLowerCase());
    } catch {
      // No display name is fine — fall back to mxid matching only.
    }

    client.on("room.message", (roomId: string, event: MatrixMessageEvent) =>
      this.onMatrixMessage(roomId, event)
    );
    await client.start();
    this.client = client;
    console.info(`[matrix] connector connected for ${this.agentId} as ${this.selfUserId}`);
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = null;
  }

  protected async post(text: string): Promise<void> {
    // Matrix has no in-place "thinking" placeholder here (postThinking is the
    // default no-op), so `replace` is never set — always send a fresh message.
    if (!this.client) return;
    await this.client.sendText(this.cfg.channelId, text.slice(0, 16000) || "(no content)");
  }

  private onMatrixMessage(roomId: string, event: MatrixMessageEvent): void {
    if (roomId !== this.cfg.channelId) return;
    if (!event.sender || event.sender === this.selfUserId) return;
    if (event.content?.msgtype !== "m.text") return;
    const text = (event.content.body ?? "").trim();
    if (!text) return;
    if (this.cfg.mentionOnly) {
      const lower = text.toLowerCase();
      if (!this.mentionTokens.some((t) => lower.includes(t))) return;
    }
    this.handleInbound(event.sender, text);
  }
}
