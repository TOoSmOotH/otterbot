# Unify chat providers across connector and transport roles

**Date:** 2026-05-24
**Status:** Approved (design)

## Context

Otterbot has two separate chat mechanisms:

- **Channel connectors** (per-agent, human ↔ one agent): Slack, Discord, Matrix.
- **Agent-to-agent bus transports** (`AGENT_TRANSPORT`): `local`, Discord, Matrix.

The roles are asymmetric and the provider plumbing is duplicated:

- Discord and Matrix each implement their client twice — once in a connector
  (`integrations/{discord,matrix}-connector.ts`) and once in a transport
  (`bus/transports/{discord,matrix}-transport.ts`) — with near-identical
  connect / listen / post / identity wiring.
- Slack has only a connector; it cannot be used as a bus transport.

The goal: every chat provider serves **both** roles, implemented **once**.
Concretely this work also ships a working **Slack bus transport**
(`AGENT_TRANSPORT=slack`), proving the abstraction.

`local` stays a distinct, non-provider transport (in-process, carries nothing
across a boundary).

## Approach

A low-level **`ChatClient`** interface captures provider plumbing. Two generic
role wrappers sit on top of it, and a registry binds provider names to their
clients. This replaces three connector subclasses and two transport classes
with **two generic wrappers + three `ChatClient` implementations**.

Each provider is written once and gets both roles for free; adding a future
provider means implementing only `ChatClient` and adding one registry entry.

### a) `ChatClient` — the only per-provider code

```ts
/** Opaque handle to a posted message, for in-place edits. */
export type MessageHandle = unknown;

/** A normalized inbound human message from a channel/room. */
export interface InboundChatMessage {
  channelId: string;
  senderId: string;
  /** Message text with a leading bot @mention stripped. */
  text: string;
  /** Sent by this bot — skip to avoid echo loops. */
  fromSelf: boolean;
  /** This bot was @mentioned — drives the connector's mentionOnly gate. */
  mentioned: boolean;
}

/** A structured agent-to-agent message for the transport role. */
export interface RichChatMessage {
  author: string; // AgentMessage.from
  kind: string;   // AgentMessage.kind
  to: string;     // AgentMessage.to ?? "all"
  body: string;
  id: string;     // AgentMessage.id
}

export interface ChatClient {
  /** True if edit() is supported (Slack/Discord true, Matrix false). */
  readonly canEdit: boolean;
  /** Register the inbound handler. Called before start(). */
  onMessage(handler: (m: InboundChatMessage) => void): void;
  /** Connect and begin listening; resolves once ready. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Post plain text; returns a handle for a later edit. */
  sendText(channelId: string, text: string): Promise<MessageHandle>;
  /** Edit a previously sent message. Only valid when canEdit. */
  edit(handle: MessageHandle, text: string): Promise<void>;
  /** Post a structured agent-to-agent message (rendered per provider). */
  sendRich(channelId: string, msg: RichChatMessage): Promise<void>;
}
```

The client listens to all of its channels and reports `channelId` on each
inbound message; each role wrapper filters to its own channel/room. Self
identity and mention detection live inside the client (provider-specific).

### b) `ChannelConnector` — one generic class

Replaces the abstract base plus `SlackConnector` / `DiscordConnector` /
`MatrixConnector`. Wraps a `ChatClient`; keeps today's behavior:

- Gate per message (`publicBot` / `allowedUserIds`) via `passesGate(senderId)`.
- `mentionOnly` applied via `InboundChatMessage.mentioned`.
- Serial queue — one agent turn at a time; runs
  `runtime.respond({ conversationId: \`${platform}-${channelId}\`, … })`.
- Thinking placeholder is capability-driven: if `client.canEdit`, post the
  placeholder then `edit()` it with the reply; otherwise just `sendText()` the
  reply. (Preserves Matrix's current no-placeholder behavior automatically.)
- `updateGate` / `getStatus` / `markConnected` / `markError` unchanged.

### c) `ChatProviderTransport` — one generic class

Replaces `DiscordTransport` and `MatrixTransport`. Implements `Transport`:

- `id`: the provider's `TransportId`.
- `send(msg)` → `client.sendRich(roomId, { author, kind, to, body, id })`.
- inbound (filtered to `roomId`, non-self, non-empty) → a `request` addressed
  to `coo`, with `transport` set to the provider id (mirrors today's
  `DiscordTransport.onDiscordMessage`).
- `start` / `stop` delegate to the client.

`LocalTransport` is untouched.

### d) Provider registry

```ts
/** Chat services that exist as bot providers (excludes "web", which is Socket.IO). */
export type ChatProviderId = Exclude<ChatService, "web">; // "slack" | "discord" | "matrix"

export interface ChatProvider {
  id: ChatProviderId;
  /** Credential keys the connector role needs (drives reconcile signature). */
  connectorTokenKeys: string[];
  /** Build a client from per-agent secrets; null if creds missing. */
  connectorClient(secrets: Map<string, string>, paths: ProviderPaths): ChatClient | null;
  /** Build a client from instance config; null if creds missing. */
  transportClient(cfg: Config): ChatClient | null;
}
export const PROVIDERS: Record<ChatProviderId, ChatProvider> = { slack, discord, matrix };
```

`ProviderPaths` carries the per-agent storage paths Matrix needs
(`storagePath`, `cryptoStoragePath`); other providers ignore it.

## Wiring changes

- **`bus/transports/factory.ts`**: `local` → `LocalTransport`; otherwise
  `PROVIDERS[cfg.agentTransport].transportClient(cfg)` → `new
  ChatProviderTransport(id, client, roomId)`, keeping the "missing creds → warn
  and fall back to local" guard.
- **`orchestrator/orchestrator.ts`**: the `slack/discord/matrixConnectors` maps
  and hand-written `reconcileOne` calls collapse into a loop over `PROVIDERS`,
  keyed by `` `${agentId}:${service}` ``. `getConnectorStatus` is built by
  iterating the registry. Profile fields are read through a small
  `{ slack, discord, matrix }` lookup so the loop stays generic.
- **`config.ts`**: add `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` /
  `SLACK_CHANNEL_ID` instance env (for the Slack bus) and accept
  `AGENT_TRANSPORT=slack`.
- **`shared/src/agent.ts`**: add `"slack"` to `TransportId`.
- **`.env.example`**: document the Slack transport vars.

### Profile schema — deliberate non-goal

Keep the explicit `profile.slack / discord / matrix` fields. A
`profile.channels: Partial<Record<ChatService, ChannelBotConfig>>` map is the
cleaner long-term shape but requires a stored-profile migration and UI churn
that this work does not need. The duplication being removed is the client
plumbing, not the connector config.

## File plan

**New**
- `integrations/chat/chat-client.ts` — `ChatClient` + message types.
- `integrations/chat/slack-client.ts` / `discord-client.ts` / `matrix-client.ts`.
- `integrations/chat/channel-connector.ts` — generic connector.
- `integrations/chat/providers.ts` — `PROVIDERS` registry.
- `bus/transports/chat-transport.ts` — `ChatProviderTransport`.

**Removed (logic moves into the clients/wrappers)**
- `integrations/{channel,slack,discord,matrix}-connector.ts`.
- `bus/transports/{discord,matrix}-transport.ts`.

**Modified**
- `bus/transports/factory.ts`, `orchestrator/orchestrator.ts`, `config.ts`,
  `shared/src/agent.ts`, `.env.example`.

## Behavior preservation

Preserved: Discord embeds & Matrix HTML-notice formatting; Matrix E2EE (the
Matrix client still owns its crypto + sync stores); Discord/Slack placeholder +
edit; Matrix no-placeholder; the `publicBot` / `allowedUserIds` gate; per-agent
(connector) vs instance (transport) credential sources.

Intentional changes:
- **Slack connector** no longer switches subscription on `mentionOnly`
  (previously `app_mention` vs `message`); it always subscribes to `message`
  and applies `mentionOnly` via the computed `mentioned` flag. Functionally
  equivalent for a bot present in the channel.
- **New Slack transport** posts agent chatter as a formatted Slack message (no
  embeds — a bold header line plus body), mirroring Discord/Matrix.

## Testing

- New: a fake `ChatClient` enables network-free unit tests of the generic
  connector (gate, `mentionOnly`, serial queue, placeholder/edit vs send-only)
  and the generic transport (outbound `sendRich` formatting, inbound → COO
  request). This coverage does not exist today.
- Existing `suggestScopeForKey`, capabilities, and API tests stay green
  (profile schema unchanged). The Slack-transport env vars are instance `.env`
  config, not per-agent stored secrets, so credential scoping is unaffected.
- Gate: `pnpm --filter @otterbot/{shared,server,web} build` clean and the full
  server vitest suite green. Live Slack/Discord/Matrix exchanges remain manual
  smoke checks.

## Out of scope

- `profile.channels` schema migration.
- Matrix message edits / thinking placeholder.
- Device verification / cross-signing for Matrix E2EE.
- The `web` chat service (handled via Socket.IO, not a connector).
