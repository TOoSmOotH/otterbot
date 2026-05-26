import { mkdirSync, rmSync } from "node:fs";
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
  /** This event's id — roots a new thread when the message is top-level. */
  event_id?: string;
  content?: MatrixMessageContent;
}

interface MatrixMessageContent {
  msgtype?: string;
  body?: string;
  /** HTML body; mention pills appear here as matrix.to links carrying the MXID. */
  formatted_body?: string;
  /** Structured mentions (MSC3952 / current spec) — the reliable signal. */
  "m.mentions"?: { user_ids?: string[] };
  /** Relations; an `m.thread` rel_type carries the thread root event id. */
  "m.relates_to"?: { rel_type?: string; event_id?: string };
}

/**
 * Whether a message mentions this bot. Prefers display-name-independent signals:
 * the structured `m.mentions.user_ids`, then the bot's MXID in the HTML pill
 * (`formatted_body`). Falls back to substring-matching the body/HTML against
 * `mentionTokens` (mxid, localpart, display name) for clients that don't send
 * either. This matters because Element renders mentions as the display name, not
 * the username, so matching the MXID against the plain body alone never fires.
 */
export function detectMention(
  selfUserId: string,
  mentionTokens: string[],
  content: MatrixMessageContent
): boolean {
  const ids = content["m.mentions"]?.user_ids;
  if (Array.isArray(ids) && ids.includes(selfUserId)) return true;
  const formatted = (content.formatted_body ?? "").toLowerCase();
  if (formatted.includes(selfUserId.toLowerCase())) return true;
  const body = (content.body ?? "").toLowerCase();
  return mentionTokens.some((t) => t.length > 0 && (body.includes(t) || formatted.includes(t)));
}

/**
 * How the Matrix client obtains its access token. The persistent rust-sdk crypto
 * store is bound to a single device, so the bot must own that device exclusively:
 * we log in with the account password to mint a dedicated device (never reuse a
 * token copied from another client like Element — that device's one-time keys are
 * owned by another crypto store and uploads collide with `M_UNKNOWN: One time key
 * … already exists`). The minted token + device id are persisted so restarts reuse
 * the same device, and a refreshed login reuses the device id to keep the crypto
 * store valid.
 */
export interface MatrixAuth {
  /** Existing/minted access token, if any. */
  token: string | null;
  /** Previously minted device id, if any. Reused on re-login to keep crypto state. */
  deviceId: string | null;
  /**
   * Account login used to mint/refresh a dedicated device. Required for the
   * per-agent connector; the instance bus transport runs token-only (login null).
   */
  login: { user: string; password: string } | null;
  /** Persist a freshly minted token + device id back to the agent's secrets. */
  persist: (token: string, deviceId: string) => void;
}

interface LoginResult {
  accessToken: string;
  deviceId: string;
}

/**
 * The rust crypto engine sends `device_keys: null` on one-time-key top-ups, but
 * the Matrix spec marks `device_keys` optional and expects it omitted when
 * absent. Strict homeservers reject the explicit null with
 * `M_INVALID_PARAM: device_keys must not be null`. Drop the null before sending
 * so `/keys/upload` stays spec-compliant. Returns the (possibly cloned) body to
 * send; non-upload requests and real device_keys pass through untouched.
 */
export function sanitizeMatrixRequestBody(endpoint: string, body: unknown): unknown {
  if (
    endpoint.endsWith("/keys/upload") &&
    typeof body === "object" &&
    body !== null &&
    "device_keys" in body &&
    (body as { device_keys?: unknown }).device_keys == null
  ) {
    const sanitized: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    delete sanitized.device_keys;
    return sanitized;
  }
  return body;
}

class SpecCompliantMatrixClient extends MatrixClient {
  override doRequest(
    method: string,
    endpoint: string,
    qs?: unknown,
    body?: unknown,
    timeout?: number,
    raw?: boolean,
    contentType?: string,
    noEncoding?: boolean
  ): Promise<unknown> {
    return super.doRequest(
      method,
      endpoint,
      qs,
      sanitizeMatrixRequestBody(endpoint, body),
      timeout,
      raw,
      contentType,
      noEncoding
    );
  }
}

/** True for errors that mean the stored access token is no longer valid. */
function isInvalidTokenError(err: unknown): boolean {
  const e = err as { statusCode?: number; body?: { errcode?: string } } | undefined;
  return e?.statusCode === 401 || e?.body?.errcode === "M_UNKNOWN_TOKEN";
}

/**
 * Password-login against the homeserver. Passing `deviceId` reuses that device
 * (issuing a fresh token for it); omitting it makes the server mint a new device.
 * Returns the access token and the device id the server assigned.
 */
async function matrixLogin(
  homeserverUrl: string,
  user: string,
  password: string,
  deviceId: string | null
): Promise<LoginResult> {
  const body: Record<string, unknown> = {
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: "otterbot",
  };
  if (deviceId) body.device_id = deviceId;
  // A token-less client just to reuse the SDK's request plumbing for /login.
  const res = (await new MatrixClient(homeserverUrl, "").doRequest(
    "POST",
    "/_matrix/client/v3/login",
    null,
    body
  )) as { access_token?: string; device_id?: string };
  if (!res.access_token || !res.device_id) {
    throw new Error("Matrix login: response missing access_token or device_id");
  }
  return { accessToken: res.access_token, deviceId: res.device_id };
}

/** Escape text for an `org.matrix.custom.html` formatted body. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Opaque handle for a sent Matrix message, used to edit it in place. */
interface MatrixMessageRef {
  roomId: string;
  eventId: string;
}

function isMatrixMessageRef(h: MessageHandle): h is MatrixMessageRef {
  return typeof h === "object" && h !== null && "roomId" in h && "eventId" in h;
}

/**
 * Matrix client plumbing for both chat roles. End-to-end encryption is always
 * enabled via a persistent rust-sdk crypto store, so messages in encrypted
 * rooms are transparently decrypted/encrypted. In-place edits (m.replace) are
 * supported so the connector can post a "thinking" placeholder and replace it
 * with the reply, matching Slack.
 */
export class MatrixChatClient implements ChatClient {
  readonly canEdit = true;
  private client: MatrixClient | null = null;
  private handler: (m: InboundChatMessage) => void = () => {};
  /**
   * Thread relations recovered from the cleartext of `m.room.encrypted` events,
   * keyed by event id. In encrypted rooms `m.relates_to` lives on the outer
   * (unencrypted) event and is dropped when the SDK replaces the content with
   * the decrypted payload, so we stash it here before decryption and read it
   * back in `onMatrixMessage`. Bounded to avoid unbounded growth.
   */
  private readonly pendingRelations = new Map<
    string,
    { rel_type?: string; event_id?: string } | undefined
  >();
  private selfUserId = "";
  private mentionTokens: string[] = [];

  constructor(
    private readonly homeserverUrl: string,
    private readonly auth: MatrixAuth,
    private readonly storagePath: string,
    private readonly cryptoStoragePath: string
  ) {}

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    mkdirSync(dirname(this.storagePath), { recursive: true });

    let token = this.auth.token;
    let deviceId = this.auth.deviceId;
    // Only trust a token we minted ourselves — one always paired with a device id.
    // A token without a device id was pasted from elsewhere (e.g. Element) and its
    // device's crypto state is owned by another store; using it collides on
    // one-time-key upload. In that case (or with no token) log in to mint our own
    // dedicated device. Minting a new device (no prior device id) means any crypto
    // store left from a previous device must be discarded first.
    if (this.auth.login && (!token || !deviceId)) {
      const mintedNewDevice = !deviceId;
      const minted = await matrixLogin(
        this.homeserverUrl,
        this.auth.login.user,
        this.auth.login.password,
        deviceId
      );
      token = minted.accessToken;
      deviceId = minted.deviceId;
      this.auth.persist(token, deviceId);
      if (mintedNewDevice) this.resetCryptoStore();
    }
    if (!token) throw new Error("Matrix: no access token and no login credentials provided");
    mkdirSync(this.cryptoStoragePath, { recursive: true });

    try {
      this.client = await this.buildClient(token);
    } catch (err) {
      if (!isInvalidTokenError(err) || !this.auth.login) throw err;
      // The stored token expired/was revoked. Re-login reusing the same device
      // id so the crypto store stays valid, then retry with the fresh token.
      const refreshed = await matrixLogin(
        this.homeserverUrl,
        this.auth.login.user,
        this.auth.login.password,
        deviceId
      );
      this.auth.persist(refreshed.accessToken, refreshed.deviceId);
      this.client = await this.buildClient(refreshed.accessToken);
    }
  }

  /** Discard the on-disk crypto store so a freshly minted device starts clean. */
  private resetCryptoStore(): void {
    rmSync(this.cryptoStoragePath, { recursive: true, force: true });
  }

  /** Build, wire, and start a MatrixClient for the given access token. */
  private async buildClient(token: string): Promise<MatrixClient> {
    const client = new SpecCompliantMatrixClient(
      this.homeserverUrl,
      token,
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
    // Tokens for the substring fallback: full MXID and the localpart
    // (`@otterthebot:hs` → `otterthebot`), plus the display name if one is set.
    const localpart = this.selfUserId.replace(/^@/, "").split(":")[0];
    this.mentionTokens = [this.selfUserId.toLowerCase(), localpart.toLowerCase()];
    try {
      const profile = (await client.getUserProfile(this.selfUserId)) as { displayname?: string };
      if (profile?.displayname) this.mentionTokens.push(profile.displayname.toLowerCase());
    } catch {
      // No display name is fine — structured mentions / pill links still match.
    }

    // The thread relation rides on the outer encrypted event's cleartext and is
    // lost on decrypt; capture it here (fires before room.message for the same
    // event) so onMatrixMessage can recover it.
    client.on(
      "room.encrypted_event",
      (_roomId: string, event: { event_id?: string; content?: MatrixMessageContent }) => {
        if (!event.event_id) return;
        this.pendingRelations.set(event.event_id, event.content?.["m.relates_to"]);
        if (this.pendingRelations.size > 500) {
          this.pendingRelations.delete(this.pendingRelations.keys().next().value as string);
        }
      }
    );
    client.on("room.message", (roomId: string, event: MatrixMessageEvent) =>
      this.onMatrixMessage(roomId, event)
    );
    await client.start();
    return client;
  }

  async stop(): Promise<void> {
    this.client?.stop();
    this.client = null;
  }

  /** Resolve a room alias (`#room:hs`) to its internal id (`!id:hs`); ids pass through. */
  async resolveChannelId(configured: string): Promise<string> {
    if (!this.client) return configured;
    return this.client.resolveRoom(configured);
  }

  async sendText(channelId: string, text: string, threadId?: string): Promise<MessageHandle> {
    if (!this.client) return null;
    const body = text.slice(0, 16000) || "(no content)";
    const eventId = threadId
      ? await this.client.sendMessage(channelId, {
          msgtype: "m.text",
          body,
          "m.relates_to": { rel_type: "m.thread", event_id: threadId },
        })
      : await this.client.sendText(channelId, body);
    return { roomId: channelId, eventId } satisfies MatrixMessageRef;
  }

  /** Replace a previously sent message with `text` via an m.replace edit. */
  async edit(handle: MessageHandle, text: string): Promise<void> {
    if (!this.client || !isMatrixMessageRef(handle)) return;
    const body = text.slice(0, 16000) || "(no content)";
    await this.client.sendMessage(handle.roomId, {
      // Fallback shown by clients that don't render edits (convention: "* …").
      msgtype: "m.text",
      body: `* ${body}`,
      "m.new_content": { msgtype: "m.text", body },
      "m.relates_to": { rel_type: "m.replace", event_id: handle.eventId },
    });
  }

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

  async sendFile(channelId: string, file: OutboundFile, threadId?: string): Promise<void> {
    if (!this.client) return;
    const url = await this.client.uploadContent(file.data, file.mimeType, file.filename);
    const msgtype = file.mimeType.startsWith("image/") ? "m.image" : "m.file";
    await this.client.sendMessage(channelId, {
      msgtype,
      url,
      body: file.filename,
      info: { mimetype: file.mimeType, size: file.data.length },
      ...(threadId && { "m.relates_to": { rel_type: "m.thread", event_id: threadId } }),
    });
  }

  private onMatrixMessage(roomId: string, event: MatrixMessageEvent): void {
    const content = event.content;
    if (content?.msgtype !== "m.text") return;
    const text = (content.body ?? "").trim();
    // In encrypted rooms the relation is stripped from `content` on decrypt;
    // fall back to the relation we stashed from the outer encrypted event.
    const stashed = event.event_id ? this.pendingRelations.get(event.event_id) : undefined;
    if (event.event_id) this.pendingRelations.delete(event.event_id);
    const rel = content["m.relates_to"] ?? stashed;
    const threadId = rel?.rel_type === "m.thread" ? rel.event_id : undefined;
    this.handler({
      channelId: roomId,
      senderId: event.sender ?? "",
      text,
      fromSelf: !event.sender || event.sender === this.selfUserId,
      mentioned: detectMention(this.selfUserId, this.mentionTokens, content),
      messageId: event.event_id ?? "",
      threadId,
    });
  }
}
