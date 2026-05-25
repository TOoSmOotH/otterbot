# Unify Chat Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the per-provider connector subclasses and transport classes into two generic wrappers over a single `ChatClient` interface, so Slack, Discord, and Matrix each serve both the per-agent connector and the agent-to-agent bus transport roles — and ship a working Slack bus transport.

**Architecture:** A low-level `ChatClient` interface holds provider plumbing (connect/listen/post/identity). One generic `ChannelConnector` and one generic `ChatProviderTransport` wrap any `ChatClient`. A `PROVIDERS` registry binds each service name to its client factories. `LocalTransport` stays a separate non-provider transport.

**Tech Stack:** TypeScript (Node ESM), Vitest, `@slack/socket-mode` + `@slack/web-api`, `discord.js`, `matrix-bot-sdk`.

**Ordering note:** Tasks 1–11 only *add* new files or *augment* existing ones, so the build stays green throughout. The old connector/transport files become unreferenced after Tasks 10–11 and are deleted in Task 12. Spec: `docs/superpowers/specs/2026-05-24-unify-chat-providers-design.md`.

---

### Task 1: ChatClient interface + message types

**Files:**
- Create: `packages/server/src/integrations/chat/chat-client.ts`

- [ ] **Step 1: Write the interface file**

```ts
/**
 * Provider plumbing shared by both chat roles (per-agent connector and the
 * agent-to-agent bus transport). One client instance is created per role with
 * its own credentials; it listens to all of its channels and reports the
 * channelId on each inbound message so each role can filter to its own
 * channel/room. Self-identity and mention detection live inside the client.
 */
export interface ChatClient {
  /** True if edit() is supported (Slack/Discord true, Matrix false). */
  readonly canEdit: boolean;
  /** Register the inbound-message handler. Called before start(). */
  onMessage(handler: (m: InboundChatMessage) => void): void;
  /** Connect and begin listening; resolves once ready. */
  start(): Promise<void>;
  /** Cleanly disconnect. */
  stop(): Promise<void>;
  /** Post plain text to a channel; returns an opaque handle for a later edit. */
  sendText(channelId: string, text: string): Promise<MessageHandle>;
  /** Edit a previously sent message in place. Only valid when canEdit. */
  edit(handle: MessageHandle, text: string): Promise<void>;
  /** Post a structured agent-to-agent message, rendered per provider. */
  sendRich(channelId: string, msg: RichChatMessage): Promise<void>;
}

/** Opaque, provider-specific handle to a posted message (for edits). */
export type MessageHandle = unknown;

/** A normalized inbound human message from a channel/room. */
export interface InboundChatMessage {
  channelId: string;
  senderId: string;
  /** Message text with a leading bot @mention stripped. */
  text: string;
  /** Sent by this bot (or any bot) — skip to avoid echo loops. */
  fromSelf: boolean;
  /** This bot was @mentioned — drives the connector's mentionOnly gate. */
  mentioned: boolean;
}

/** A structured agent-to-agent message for the transport role. */
export interface RichChatMessage {
  /** AgentMessage.from */
  author: string;
  /** AgentMessage.kind */
  kind: string;
  /** AgentMessage.to ?? "all" */
  to: string;
  /** AgentMessage.body */
  body: string;
  /** AgentMessage.id */
  id: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no output / clean tsc).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/integrations/chat/chat-client.ts
git commit -m "feat(chat): add ChatClient interface and message types"
```

---

### Task 2: FakeChatClient test helper

**Files:**
- Create: `packages/server/src/test/fake-chat-client.ts`

- [ ] **Step 1: Write the fake**

```ts
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  RichChatMessage,
} from "../integrations/chat/chat-client.js";

/** An in-memory ChatClient for network-free tests of the generic wrappers. */
export class FakeChatClient implements ChatClient {
  readonly canEdit: boolean;
  started = false;
  stopped = false;
  sent: { channelId: string; text: string }[] = [];
  edits: { handle: MessageHandle; text: string }[] = [];
  rich: { channelId: string; msg: RichChatMessage }[] = [];
  private handler: (m: InboundChatMessage) => void = () => {};
  private seq = 0;

  constructor(canEdit = true) {
    this.canEdit = canEdit;
  }

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    this.sent.push({ channelId, text });
    return `handle-${this.seq++}`;
  }
  async edit(handle: MessageHandle, text: string): Promise<void> {
    this.edits.push({ handle, text });
  }
  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    this.rich.push({ channelId, msg });
  }

  /** Test helper: simulate an inbound message (defaults are a plain user msg). */
  emit(m: Partial<InboundChatMessage> = {}): void {
    this.handler({
      channelId: "C1",
      senderId: "U1",
      text: "hello",
      fromSelf: false,
      mentioned: false,
      ...m,
    });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/test/fake-chat-client.ts
git commit -m "test(chat): add FakeChatClient helper"
```

---

### Task 3: Generic ChannelConnector (TDD)

**Files:**
- Create: `packages/server/src/integrations/chat/channel-connector.ts`
- Test: `packages/server/src/integrations/chat/channel-connector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { ChannelBotConfig } from "@otterbot/shared";
import { FakeChatClient } from "../../test/fake-chat-client.js";
import { ChannelConnector } from "./channel-connector.js";

function cfg(over: Partial<ChannelBotConfig> = {}): ChannelBotConfig {
  return {
    enabled: true,
    channelId: "C1",
    publicBot: true,
    allowedUserIds: [],
    mentionOnly: false,
    ...over,
  };
}

/** Records inbound prompts and returns a deterministic reply. */
function fakeRuntime(calls: string[] = []) {
  return {
    calls,
    runtime: {
      respond: async ({ userMessage }: { userMessage: string }) => {
        calls.push(userMessage);
        return { finalText: `echo:${userMessage}` };
      },
    } as never,
  };
}

function make(client: FakeChatClient, c: ChannelBotConfig, runtime: unknown) {
  return new ChannelConnector("test", "agent-1", c, client, () => runtime as never);
}

describe("ChannelConnector", () => {
  it("runs an agent turn and posts the reply", async () => {
    const client = new FakeChatClient(false); // no edit → no placeholder
    const { runtime } = fakeRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "hi there" });
    await conn.whenIdle();
    expect(client.sent).toEqual([{ channelId: "C1", text: "echo:hi there" }]);
    expect(client.edits).toEqual([]);
  });

  it("posts a thinking placeholder then edits it when canEdit", async () => {
    const client = new FakeChatClient(true);
    const { runtime } = fakeRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "hi" });
    await conn.whenIdle();
    expect(client.sent.length).toBe(1); // placeholder only
    expect(client.edits).toEqual([{ handle: "handle-0", text: "echo:hi" }]);
  });

  it("ignores its own / bot messages", async () => {
    const client = new FakeChatClient(false);
    const { runtime, calls } = fakeRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ fromSelf: true });
    await conn.whenIdle();
    expect(calls).toEqual([]);
  });

  it("ignores messages in other channels", async () => {
    const client = new FakeChatClient(false);
    const { runtime, calls } = fakeRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ channelId: "OTHER" });
    await conn.whenIdle();
    expect(calls).toEqual([]);
  });

  it("with mentionOnly, only replies when mentioned", async () => {
    const client = new FakeChatClient(false);
    const { runtime, calls } = fakeRuntime();
    const conn = make(client, cfg({ mentionOnly: true }), runtime);
    await conn.start();
    client.emit({ mentioned: false });
    await conn.whenIdle();
    expect(calls).toEqual([]);
    client.emit({ text: "ping", mentioned: true });
    await conn.whenIdle();
    expect(calls).toEqual(["ping"]);
  });

  it("with publicBot off, only replies to allowed user ids", async () => {
    const client = new FakeChatClient(false);
    const { runtime, calls } = fakeRuntime();
    const conn = make(client, cfg({ publicBot: false, allowedUserIds: ["U1"] }), runtime);
    await conn.start();
    client.emit({ senderId: "U2", text: "blocked" });
    await conn.whenIdle();
    expect(calls).toEqual([]);
    client.emit({ senderId: "U1", text: "allowed" });
    await conn.whenIdle();
    expect(calls).toEqual(["allowed"]);
  });

  it("processes messages serially in order", async () => {
    const client = new FakeChatClient(false);
    const { runtime, calls } = fakeRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "one" });
    client.emit({ text: "two" });
    await conn.whenIdle();
    expect(calls).toEqual(["one", "two"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- channel-connector`
Expected: FAIL — cannot find module `./channel-connector.js` / `ChannelConnector is not a constructor`.

- [ ] **Step 3: Write the implementation**

```ts
import type { ChannelBotConfig, ConnectorState } from "@otterbot/shared";
import type { AgentRuntime } from "../../runtime/agent-runtime.js";
import type { ChatClient, InboundChatMessage, MessageHandle } from "./chat-client.js";

/** Placeholder posted while the agent works, when the client supports edits. */
export const THINKING_PLACEHOLDER = "💭 _Thinking…_";

/**
 * Connects one agent to a single chat channel via a ChatClient so humans there
 * can talk to it. The `publicBot` gate decides who may talk to the agent; the
 * gate is evaluated per message and can be updated in place without
 * reconnecting. Messages run one agent turn at a time (serial queue).
 */
export class ChannelConnector {
  private cfg: ChannelBotConfig;
  private queue: Promise<unknown> = Promise.resolve();
  private connState: ConnectorState = "connecting";
  private connError: string | null = null;

  constructor(
    /** Prefix for the runtime conversation id, e.g. "slack". */
    private readonly platform: string,
    private readonly agentId: string,
    cfg: ChannelBotConfig,
    private readonly client: ChatClient,
    private readonly getRuntime: () => AgentRuntime | undefined
  ) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    this.client.onMessage((m) => this.onInbound(m));
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  /** Update the gate (publicBot / allowedUserIds) without reconnecting. */
  updateGate(cfg: ChannelBotConfig): void {
    this.cfg = cfg;
  }

  /** Resolves once the currently-queued messages have been handled (tests). */
  async whenIdle(): Promise<void> {
    await this.queue;
  }

  getStatus(): { state: ConnectorState; error: string | null; channelId: string } {
    return { state: this.connState, error: this.connError, channelId: this.cfg.channelId };
  }
  markConnected(): void {
    this.connState = "connected";
    this.connError = null;
  }
  markError(message: string): void {
    this.connState = "error";
    this.connError = message;
  }

  private passesGate(userId: string): boolean {
    if (this.cfg.publicBot) return true;
    return this.cfg.allowedUserIds.includes(userId);
  }

  private onInbound(m: InboundChatMessage): void {
    if (m.channelId !== this.cfg.channelId) return;
    if (m.fromSelf) return;
    if (this.cfg.mentionOnly && !m.mentioned) return;
    const body = m.text.trim();
    if (!body || !this.passesGate(m.senderId)) return;
    this.queue = this.queue.then(async () => {
      const runtime = this.getRuntime();
      if (!runtime) return;
      let placeholder: MessageHandle | null = null;
      if (this.client.canEdit) {
        try {
          placeholder = await this.client.sendText(this.cfg.channelId, THINKING_PLACEHOLDER);
        } catch (err) {
          console.warn(`[${this.platform}] thinking placeholder failed for ${this.agentId}:`, err);
        }
      }
      let reply: string;
      try {
        const res = await runtime.respond({
          conversationId: `${this.platform}-${this.cfg.channelId}`,
          userMessage: body,
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
      } catch (err) {
        reply = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      try {
        if (placeholder != null) {
          await this.client.edit(placeholder, reply);
        } else {
          await this.client.sendText(this.cfg.channelId, reply);
        }
      } catch (err) {
        console.warn(`[${this.platform}] post failed for ${this.agentId}:`, err);
      }
    });
  }
}

/** Stable signature used to decide when a connector must reconnect. */
export function connectorSignature(cfg: ChannelBotConfig | null, tokens: string[]): string {
  if (!cfg?.enabled) return "disabled";
  return JSON.stringify([cfg.channelId, cfg.mentionOnly, tokens]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- channel-connector`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/integrations/chat/channel-connector.ts packages/server/src/integrations/chat/channel-connector.test.ts
git commit -m "feat(chat): generic ChannelConnector over ChatClient"
```

---

### Task 4: Generic ChatProviderTransport (TDD)

**Files:**
- Create: `packages/server/src/bus/transports/chat-transport.ts`
- Test: `packages/server/src/bus/transports/chat-transport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@otterbot/shared";
import { FakeChatClient } from "../../test/fake-chat-client.js";
import { ChatProviderTransport } from "./chat-transport.js";

function msg(over: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "m1",
    seq: 0,
    kind: "broadcast",
    from: "alice",
    to: null,
    threadId: "t1",
    correlationId: null,
    rootSpawnId: null,
    body: "hello swarm",
    transport: "discord",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("ChatProviderTransport", () => {
  it("sends an AgentMessage as a rich message to the room", async () => {
    const client = new FakeChatClient();
    const t = new ChatProviderTransport("discord", client, "C1");
    await t.start();
    expect(client.started).toBe(true);
    await t.send(msg({ kind: "request", to: "bob", body: "do x", id: "m9" }));
    expect(client.rich).toEqual([
      { channelId: "C1", msg: { author: "alice", kind: "request", to: "bob", body: "do x", id: "m9" } },
    ]);
  });

  it("maps to:null to 'all'", async () => {
    const client = new FakeChatClient();
    const t = new ChatProviderTransport("discord", client, "C1");
    await t.send(msg({ to: null }));
    expect(client.rich[0].msg.to).toBe("all");
  });

  it("routes an inbound human message to the COO as a request", async () => {
    const client = new FakeChatClient();
    const t = new ChatProviderTransport("discord", client, "C1");
    const received: AgentMessage[] = [];
    t.onReceive((m) => received.push(m));
    await t.start();
    client.emit({ channelId: "C1", senderId: "U1", text: "hey swarm" });
    expect(received.length).toBe(1);
    expect(received[0]).toMatchObject({
      kind: "request",
      to: "coo",
      body: "hey swarm",
      transport: "discord",
    });
  });

  it("ignores self messages, other rooms, and empty text", async () => {
    const client = new FakeChatClient();
    const t = new ChatProviderTransport("discord", client, "C1");
    const received: AgentMessage[] = [];
    t.onReceive((m) => received.push(m));
    await t.start();
    client.emit({ channelId: "C1", fromSelf: true });
    client.emit({ channelId: "OTHER", text: "x" });
    client.emit({ channelId: "C1", text: "   " });
    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- chat-transport`
Expected: FAIL — cannot find module `./chat-transport.js`.

- [ ] **Step 3: Write the implementation**

```ts
import { nanoid } from "nanoid";
import type { AgentMessage, TransportId } from "@otterbot/shared";
import type { ChatClient, InboundChatMessage } from "../../integrations/chat/chat-client.js";
import type { Transport } from "./transport.js";

/**
 * Routes agent-to-agent messages through a shared chat room via a ChatClient.
 * Each agent message is rendered by the provider (Discord embed / Matrix notice
 * / Slack formatted text). A human message typed in the room becomes a request
 * routed to the COO, letting a person talk to the swarm.
 */
export class ChatProviderTransport implements Transport {
  private receiveHandler: (msg: AgentMessage) => void = () => {};

  constructor(
    readonly id: TransportId,
    private readonly client: ChatClient,
    private readonly roomId: string
  ) {}

  async start(): Promise<void> {
    this.client.onMessage((m) => this.onInbound(m));
    await this.client.start();
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }

  async send(msg: AgentMessage): Promise<void> {
    await this.client.sendRich(this.roomId, {
      author: msg.from,
      kind: msg.kind,
      to: msg.to ?? "all",
      body: msg.body,
      id: msg.id,
    });
  }

  onReceive(handler: (msg: AgentMessage) => void): void {
    this.receiveHandler = handler;
  }

  private onInbound(m: InboundChatMessage): void {
    if (m.channelId !== this.roomId || m.fromSelf) return;
    const body = m.text.trim();
    if (!body) return;
    this.receiveHandler({
      id: nanoid(),
      seq: 0,
      kind: "request",
      from: `${this.id}-user`,
      to: "coo",
      threadId: nanoid(),
      correlationId: null,
      rootSpawnId: null,
      body,
      transport: this.id,
      createdAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- chat-transport`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/bus/transports/chat-transport.ts packages/server/src/bus/transports/chat-transport.test.ts
git commit -m "feat(chat): generic ChatProviderTransport over ChatClient"
```

---

### Task 5: DiscordChatClient

**Files:**
- Create: `packages/server/src/integrations/chat/discord-client.ts`

- [ ] **Step 1: Write the client (ported from discord-connector + discord-transport)**

```ts
import {
  Client,
  Events,
  GatewayIntentBits,
  EmbedBuilder,
  type Message,
  type SendableChannels,
} from "discord.js";
import type { AgentMsgKind } from "@otterbot/shared";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  RichChatMessage,
} from "./chat-client.js";

const KIND_COLOR: Record<AgentMsgKind, number> = {
  request: 0x6b8cff,
  response: 0x4ade80,
  broadcast: 0xa78bfa,
  spawn: 0xfbbf24,
  report: 0x4ade80,
  status: 0x5a5a64,
  tool: 0x5a5a64,
  error: 0xf87171,
};

/**
 * Discord client plumbing for both chat roles. Reads a bot token; requires the
 * (privileged) Message Content intent. Edits are supported (canEdit = true).
 */
export class DiscordChatClient implements ChatClient {
  readonly canEdit = true;
  private client: Client | null = null;
  private handler: (m: InboundChatMessage) => void = () => {};
  private readonly channels = new Map<string, SendableChannels>();

  constructor(private readonly botToken: string) {}

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    await client.login(this.botToken);
    await new Promise<void>((resolve) => {
      if (client.isReady()) resolve();
      else client.once(Events.ClientReady, () => resolve());
    });
    client.on(Events.MessageCreate, (m) => this.onDiscordMessage(m));
    this.client = client;
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.channels.clear();
  }

  private async channel(id: string): Promise<SendableChannels | null> {
    const cached = this.channels.get(id);
    if (cached) return cached;
    const ch = await this.client?.channels.fetch(id);
    if (ch && ch.isTextBased() && ch.isSendable()) {
      this.channels.set(id, ch);
      return ch;
    }
    console.warn(`[discord] channel is not a sendable text channel: ${id}`);
    return null;
  }

  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    const ch = await this.channel(channelId);
    if (!ch) return null;
    return await ch.send(text.slice(0, 2000) || "(no content)");
  }

  async edit(handle: MessageHandle, text: string): Promise<void> {
    if (handle) await (handle as Message).edit(text.slice(0, 2000) || "(no content)");
  }

  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    const ch = await this.channel(channelId);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setColor(KIND_COLOR[msg.kind as AgentMsgKind] ?? 0x5a5a64)
      .setAuthor({ name: msg.author })
      .setDescription(msg.body.slice(0, 4000) || "(no content)")
      .setFooter({ text: `${msg.kind} → ${msg.to} · ${msg.id}` });
    await ch.send({ embeds: [embed] });
  }

  private onDiscordMessage(m: Message): void {
    const self = this.client?.user;
    if (!self) return;
    const mentioned = m.mentions.has(self);
    const text = m.content.replace(new RegExp(`<@!?${self.id}>`, "g"), "").trim();
    this.handler({
      channelId: m.channelId,
      senderId: m.author.id,
      text,
      fromSelf: m.author.bot,
      mentioned,
    });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/integrations/chat/discord-client.ts
git commit -m "feat(chat): DiscordChatClient"
```

---

### Task 6: MatrixChatClient

**Files:**
- Create: `packages/server/src/integrations/chat/matrix-client.ts`

- [ ] **Step 1: Write the client (ported from matrix-connector + matrix-transport, E2EE preserved)**

```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/integrations/chat/matrix-client.ts
git commit -m "feat(chat): MatrixChatClient with E2EE"
```

---

### Task 7: SlackChatClient (includes new sendRich for the transport)

**Files:**
- Create: `packages/server/src/integrations/chat/slack-client.ts`

- [ ] **Step 1: Write the client (ported from slack-connector; always subscribes to `message`)**

```ts
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import type {
  ChatClient,
  InboundChatMessage,
  MessageHandle,
  RichChatMessage,
} from "./chat-client.js";

/** The subset of a Slack message event we use. */
interface SlackMessageEvent {
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  bot_id?: string;
}

/** A Slack message handle is the channel + ts needed to edit it. */
interface SlackHandle {
  channel: string;
  ts: string;
}

/** Strip a leading bot @mention (`<@U…> `) so the agent gets a clean prompt. */
function stripLeadingMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, "");
}

/**
 * Slack client plumbing for both chat roles, over Socket Mode (events) + Web
 * API (posting). Reads a bot token (xoxb-) and app token (xapp-). Always
 * subscribes to `message`; mentionOnly is applied by the connector via the
 * computed `mentioned` flag. Edits are supported (canEdit = true).
 */
export class SlackChatClient implements ChatClient {
  readonly canEdit = true;
  private socket: SocketModeClient | null = null;
  private readonly web: WebClient;
  private handler: (m: InboundChatMessage) => void = () => {};
  private selfUserId = "";

  constructor(
    botToken: string,
    private readonly appToken: string
  ) {
    this.web = new WebClient(botToken);
  }

  onMessage(handler: (m: InboundChatMessage) => void): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const auth = (await this.web.auth.test()) as { user_id?: string };
    this.selfUserId = auth.user_id ?? "";
    const socket = new SocketModeClient({ appToken: this.appToken });
    socket.on(
      "message",
      ({ event, ack }: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
        void ack();
        this.onSlackMessage(event);
      }
    );
    await socket.start();
    this.socket = socket;
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect();
    this.socket = null;
  }

  async sendText(channelId: string, text: string): Promise<MessageHandle> {
    const res = await this.web.chat.postMessage({ channel: channelId, text });
    return res.ts ? ({ channel: channelId, ts: res.ts } satisfies SlackHandle) : null;
  }

  async edit(handle: MessageHandle, text: string): Promise<void> {
    const h = handle as SlackHandle | null;
    if (!h) return;
    await this.web.chat.update({ channel: h.channel, ts: h.ts, text });
  }

  async sendRich(channelId: string, msg: RichChatMessage): Promise<void> {
    const header = `${msg.author} · ${msg.kind} → ${msg.to}`;
    const body = msg.body || "(no content)";
    await this.web.chat.postMessage({ channel: channelId, text: `*${header}*\n${body}` });
  }

  private onSlackMessage(event: SlackMessageEvent): void {
    if (event.subtype || event.bot_id) return;
    if (!event.channel || !event.user || !event.text) return;
    const mentioned = this.selfUserId !== "" && event.text.includes(`<@${this.selfUserId}>`);
    this.handler({
      channelId: event.channel,
      senderId: event.user,
      text: stripLeadingMention(event.text),
      fromSelf: event.user === this.selfUserId,
      mentioned,
    });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/integrations/chat/slack-client.ts
git commit -m "feat(chat): SlackChatClient for both connector and transport roles"
```

---

### Task 8: Config + shared TransportId for Slack transport

**Files:**
- Modify: `packages/shared/src/agent.ts` (TransportId)
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add "slack" to TransportId**

In `packages/shared/src/agent.ts`, change:

```ts
export type TransportId = "local" | "discord" | "matrix";
```

to:

```ts
export type TransportId = "local" | "discord" | "matrix" | "slack";
```

- [ ] **Step 2: Add Slack transport config fields**

In `packages/server/src/config.ts`, in the `Config` interface after the matrix fields, add:

```ts
  slackBotToken: string | null;
  slackAppToken: string | null;
  slackChannelId: string | null;
```

Change the `agentTransport` field type to include slack:

```ts
  agentTransport: "local" | "discord" | "matrix" | "slack";
```

In `loadConfig()`, change the `agentTransport` assignment to:

```ts
    agentTransport: ((): Config["agentTransport"] => {
      const t = process.env.AGENT_TRANSPORT;
      return t === "discord" || t === "matrix" || t === "slack" ? t : "local";
    })(),
```

and after the `matrixRoomId` line add:

```ts
    slackBotToken: process.env.SLACK_BOT_TOKEN ?? null,
    slackAppToken: process.env.SLACK_APP_TOKEN ?? null,
    slackChannelId: process.env.SLACK_CHANNEL_ID ?? null,
```

- [ ] **Step 3: Build shared then server**

Run: `pnpm --filter @otterbot/shared build && pnpm --filter @otterbot/server build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/agent.ts packages/server/src/config.ts
git commit -m "feat(chat): config + TransportId for Slack bus transport"
```

---

### Task 9: Provider registry

**Files:**
- Create: `packages/server/src/integrations/chat/providers.ts`

- [ ] **Step 1: Write the registry**

```ts
import { join } from "node:path";
import type { Config } from "../../config.js";
import type { ChatClient } from "./chat-client.js";
import { SlackChatClient } from "./slack-client.js";
import { DiscordChatClient } from "./discord-client.js";
import { MatrixChatClient } from "./matrix-client.js";

/** Chat services that exist as bot providers (excludes "web" / Socket.IO). */
export type ChatProviderId = "slack" | "discord" | "matrix";

/** Per-agent storage paths a connector client may need (Matrix uses them). */
export interface ProviderPaths {
  storagePath: string;
  cryptoStoragePath: string;
}

export interface ChatProvider {
  id: ChatProviderId;
  /** Credential keys the connector role needs (drives the reconcile signature). */
  connectorTokenKeys: string[];
  /** Build a connector client from per-agent secrets; null if creds missing. */
  connectorClient(secrets: Map<string, string>, paths: ProviderPaths): ChatClient | null;
  /** Build a transport client from instance config; null if creds missing. */
  transportClient(cfg: Config): ChatClient | null;
  /** The room/channel id the transport posts to; null if not configured. */
  transportRoomId(cfg: Config): string | null;
}

export const PROVIDERS: Record<ChatProviderId, ChatProvider> = {
  slack: {
    id: "slack",
    connectorTokenKeys: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    connectorClient(secrets) {
      const bot = secrets.get("SLACK_BOT_TOKEN");
      const app = secrets.get("SLACK_APP_TOKEN");
      return bot && app ? new SlackChatClient(bot, app) : null;
    },
    transportClient(cfg) {
      return cfg.slackBotToken && cfg.slackAppToken
        ? new SlackChatClient(cfg.slackBotToken, cfg.slackAppToken)
        : null;
    },
    transportRoomId: (cfg) => cfg.slackChannelId,
  },
  discord: {
    id: "discord",
    connectorTokenKeys: ["DISCORD_BOT_TOKEN"],
    connectorClient(secrets) {
      const bot = secrets.get("DISCORD_BOT_TOKEN");
      return bot ? new DiscordChatClient(bot) : null;
    },
    transportClient(cfg) {
      return cfg.discordBotToken ? new DiscordChatClient(cfg.discordBotToken) : null;
    },
    transportRoomId: (cfg) => cfg.discordChannelId,
  },
  matrix: {
    id: "matrix",
    connectorTokenKeys: ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN"],
    connectorClient(secrets, paths) {
      const url = secrets.get("MATRIX_HOMESERVER_URL");
      const token = secrets.get("MATRIX_ACCESS_TOKEN");
      return url && token
        ? new MatrixChatClient(url, token, paths.storagePath, paths.cryptoStoragePath)
        : null;
    },
    transportClient(cfg) {
      return cfg.matrixHomeserverUrl && cfg.matrixAccessToken
        ? new MatrixChatClient(
            cfg.matrixHomeserverUrl,
            cfg.matrixAccessToken,
            join(cfg.dataDir, "matrix", "bus.json"),
            join(cfg.dataDir, "matrix", "crypto-bus")
          )
        : null;
    },
    transportRoomId: (cfg) => cfg.matrixRoomId,
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (config fields from Task 8 are now present).

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/integrations/chat/providers.ts
git commit -m "feat(chat): provider registry"
```

---

### Task 10: Rewire the transport factory

**Files:**
- Modify: `packages/server/src/bus/transports/factory.ts`

- [ ] **Step 1: Replace the factory body**

Replace the entire contents of `packages/server/src/bus/transports/factory.ts` with:

```ts
import type { Config } from "../../config.js";
import type { Transport } from "./transport.js";
import { LocalTransport } from "./local-transport.js";
import { ChatProviderTransport } from "./chat-transport.js";
import { PROVIDERS, type ChatProviderId } from "../../integrations/chat/providers.js";

/**
 * Pick the agent-to-agent transport from config. Defaults to the in-process
 * local transport; `AGENT_TRANSPORT=slack|discord|matrix` (with that provider's
 * credentials + a room/channel id) routes agent chatter through a shared room.
 */
export function createTransport(cfg: Config): Transport {
  if (cfg.agentTransport === "local") return new LocalTransport();
  const provider = PROVIDERS[cfg.agentTransport as ChatProviderId];
  if (provider) {
    const client = provider.transportClient(cfg);
    const roomId = provider.transportRoomId(cfg);
    if (client && roomId) return new ChatProviderTransport(provider.id, client, roomId);
    console.warn(
      `[transport] AGENT_TRANSPORT=${cfg.agentTransport} but its credentials / room id are missing; falling back to local`
    );
  }
  return new LocalTransport();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS. (`discord-transport.ts` / `matrix-transport.ts` are now unreferenced but still compile.)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/bus/transports/factory.ts
git commit -m "refactor(chat): transport factory uses provider registry"
```

---

### Task 11: Rewire the orchestrator connectors

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Swap the connector imports**

Replace these lines:

```ts
import {
  type ChannelConnector,
  connectorSignature,
} from "../integrations/channel-connector.js";
import { WebClient } from "@slack/web-api";
import { SlackConnector } from "../integrations/slack-connector.js";
import { DiscordConnector } from "../integrations/discord-connector.js";
import { MatrixConnector } from "../integrations/matrix-connector.js";
```

with:

```ts
import {
  ChannelConnector,
  connectorSignature,
} from "../integrations/chat/channel-connector.js";
import { WebClient } from "@slack/web-api";
import { PROVIDERS, type ChatProviderId, type ChatProvider } from "../integrations/chat/providers.js";
```

(`WebClient` stays — `testSlackToken` still uses it directly.)

- [ ] **Step 2: Replace the three connector maps with one**

Replace:

```ts
  private readonly slackConnectors = new Map<string, TrackedConnector<SlackConnector>>();
  private readonly discordConnectors = new Map<string, TrackedConnector<DiscordConnector>>();
  private readonly matrixConnectors = new Map<string, TrackedConnector<MatrixConnector>>();
```

with:

```ts
  /** Per-agent chat connectors, keyed by `${agentId}:${service}`. */
  private readonly connectors = new Map<string, TrackedConnector<ChannelConnector>>();
```

- [ ] **Step 3: Update shutdown() connector teardown**

Replace:

```ts
    await Promise.allSettled([
      ...[...this.slackConnectors.values()].map((t) => t.connector.stop()),
      ...[...this.discordConnectors.values()].map((t) => t.connector.stop()),
      ...[...this.matrixConnectors.values()].map((t) => t.connector.stop()),
    ]);
    this.slackConnectors.clear();
    this.discordConnectors.clear();
    this.matrixConnectors.clear();
```

with:

```ts
    await Promise.allSettled([...this.connectors.values()].map((t) => t.connector.stop()));
    this.connectors.clear();
```

- [ ] **Step 4: Replace getConnectorStatus()**

Replace the method body:

```ts
  getConnectorStatus(id: string): AgentConnectorStatus | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    return {
      slack: channelStatus(ctx.profile.slack, this.slackConnectors.get(id)),
      discord: channelStatus(ctx.profile.discord, this.discordConnectors.get(id)),
      matrix: channelStatus(ctx.profile.matrix, this.matrixConnectors.get(id)),
    };
  }
```

with:

```ts
  getConnectorStatus(id: string): AgentConnectorStatus | null {
    const ctx = this.contexts.get(id);
    if (!ctx) return null;
    return {
      slack: channelStatus(ctx.profile.slack, this.connectors.get(`${id}:slack`)),
      discord: channelStatus(ctx.profile.discord, this.connectors.get(`${id}:discord`)),
      matrix: channelStatus(ctx.profile.matrix, this.connectors.get(`${id}:matrix`)),
    };
  }
```

- [ ] **Step 5: Replace reconcileConnectors() and reconcileOne()**

Replace the whole `reconcileConnectors` method and the `reconcileOne` method with:

```ts
  /** A per-service view of a profile's connector configs. */
  private channelConfig(profile: AgentProfile): Record<ChatProviderId, ChannelBotConfig | null> {
    return { slack: profile.slack, discord: profile.discord, matrix: profile.matrix };
  }

  private reconcileConnectors(profile: AgentProfile): void {
    const secrets = this.secrets.get(profile.id);
    const cfgByService = this.channelConfig(profile);
    for (const provider of Object.values(PROVIDERS)) {
      const tokens = provider.connectorTokenKeys.map((k) => secrets.get(k) ?? "");
      this.reconcileOne(provider, profile.id, cfgByService[provider.id], tokens, secrets);
    }
  }

  private reconcileOne(
    provider: ChatProvider,
    agentId: string,
    cfg: ChannelBotConfig | null,
    tokens: string[],
    secrets: Map<string, string>
  ): void {
    const key = `${agentId}:${provider.id}`;
    const existing = this.connectors.get(key);
    if (!cfg?.enabled || tokens.some((t) => !t)) {
      if (existing) {
        void existing.connector.stop();
        this.connectors.delete(key);
      }
      return;
    }
    const signature = connectorSignature(cfg, tokens);
    if (existing && existing.signature === signature) {
      existing.connector.updateGate(cfg);
      return;
    }
    if (existing) void existing.connector.stop();
    const client = provider.connectorClient(secrets, {
      storagePath: join(this.cfg.dataDir, "matrix", `connector-${agentId}.json`),
      cryptoStoragePath: join(this.cfg.dataDir, "matrix", `crypto-connector-${agentId}`),
    });
    if (!client) return;
    const connector = new ChannelConnector(provider.id, agentId, cfg, client, () =>
      this.runtimes.get(agentId)
    );
    this.connectors.set(key, { connector, signature });
    this.pendingInits.push(
      connector
        .start()
        .then(() => connector.markConnected())
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          connector.markError(message);
          console.warn(`[connector] start failed for ${agentId}:`, message);
        })
    );
  }
```

- [ ] **Step 6: Replace stopConnectors()**

Replace:

```ts
  private async stopConnectors(agentId: string): Promise<void> {
    const slack = this.slackConnectors.get(agentId);
    const discord = this.discordConnectors.get(agentId);
    const matrix = this.matrixConnectors.get(agentId);
    this.slackConnectors.delete(agentId);
    this.discordConnectors.delete(agentId);
    this.matrixConnectors.delete(agentId);
    await Promise.allSettled([
      slack?.connector.stop(),
      discord?.connector.stop(),
      matrix?.connector.stop(),
    ]);
  }
```

with:

```ts
  private async stopConnectors(agentId: string): Promise<void> {
    const prefix = `${agentId}:`;
    const stops: Promise<void>[] = [];
    for (const [key, tracked] of this.connectors) {
      if (key.startsWith(prefix)) {
        stops.push(tracked.connector.stop());
        this.connectors.delete(key);
      }
    }
    await Promise.allSettled(stops);
  }
```

- [ ] **Step 7: Build**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS. The old connector files are now unreferenced.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts
git commit -m "refactor(chat): orchestrator drives connectors via provider registry"
```

---

### Task 12: Delete the superseded files and verify the whole suite

**Files:**
- Delete: `packages/server/src/integrations/channel-connector.ts`
- Delete: `packages/server/src/integrations/slack-connector.ts`
- Delete: `packages/server/src/integrations/discord-connector.ts`
- Delete: `packages/server/src/integrations/matrix-connector.ts`
- Delete: `packages/server/src/bus/transports/discord-transport.ts`
- Delete: `packages/server/src/bus/transports/matrix-transport.ts`

- [ ] **Step 1: Confirm nothing still imports them**

Run:
```bash
grep -rn "integrations/channel-connector\|integrations/slack-connector\|integrations/discord-connector\|integrations/matrix-connector\|transports/discord-transport\|transports/matrix-transport" packages/server/src
```
Expected: no matches.

- [ ] **Step 2: Delete the files**

```bash
git rm packages/server/src/integrations/channel-connector.ts \
       packages/server/src/integrations/slack-connector.ts \
       packages/server/src/integrations/discord-connector.ts \
       packages/server/src/integrations/matrix-connector.ts \
       packages/server/src/bus/transports/discord-transport.ts \
       packages/server/src/bus/transports/matrix-transport.ts
```

- [ ] **Step 3: Build + full test suite**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/server test`
Expected: tsc clean; all tests PASS (the previous 154 plus the new connector + transport tests).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(chat): remove superseded connector and transport classes"
```

---

### Task 13: Document the Slack transport + final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document the Slack bus transport**

In `.env.example`, in the "Agent-to-agent transport" block, update the `local | discord | matrix` comment to `local | discord | matrix | slack` and after the Matrix lines add:

```bash
# SLACK_* — set only if AGENT_TRANSPORT=slack
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...
# SLACK_CHANNEL_ID=C0123456789
```

- [ ] **Step 2: Build web (no schema change, but confirm green)**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm --filter @otterbot/shared build && pnpm --filter @otterbot/server build && pnpm --filter @otterbot/web build && pnpm --filter @otterbot/server test`
Expected: all clean / green.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(chat): document AGENT_TRANSPORT=slack"
```

---

## Manual smoke checks (post-merge, require live accounts)

- **Slack transport:** `AGENT_TRANSPORT=slack` + `SLACK_BOT_TOKEN`/`SLACK_APP_TOKEN`/`SLACK_CHANNEL_ID`; confirm agent-to-agent messages post to the channel and a human message there reaches the COO.
- **Connectors regression:** enable each of Slack / Discord / Matrix on an agent and confirm a human message gets a reply (Discord/Slack show the thinking placeholder being edited; Matrix posts the reply directly).
- **Matrix E2EE:** confirm encrypted-room messages are still decrypted/encrypted in both connector and transport roles.
