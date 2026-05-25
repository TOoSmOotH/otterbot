# Post agent-produced images & files to chat connectors

**Date:** 2026-05-24
**Status:** Approved (design)

## Context

Otterbot agents can generate images (`generate_image` / `edit_image`, stored as
PNGs under `<profile>/images/`) and produce file artifacts (under
`<profile>/files/`). `AgentRuntime.respond()` already returns every artifact a
turn produced — both locally generated and those merged in from a delegated
peer (e.g. a dedicated image-creation agent) — as `RespondResult.artifacts:
Artifact[]`.

The per-agent chat connectors (Slack / Discord / Matrix) only post the agent's
`finalText`; they ignore `res.artifacts`. So when a human in a channel asks the
agent for an image, the agent makes it but the channel never shows it. This
adds image/file posting to the connector role.

`Artifact` (`@otterbot/shared`): `{ id, kind: "image" | "file", url:
"/api/agents/<agentId>/{images|files}/<id>", name, mimeType, prompt? }`. Bytes
live on disk and are resolved by the orchestrator's `agentImagePath(id, file)`
and `agentFilePath(id, file)` (both traversal-guarded).

## Scope

- **Connector role only** (human ↔ agent channels). The agent-to-agent bus
  transport is **out of scope**.
- **Images and other files.** Image artifacts render inline; non-image
  artifacts post as file attachments.
- **No caption.** Post the text reply as today, then upload each artifact bare
  (filename only). The reply text already describes the image.
- Triggered by `res.artifacts` for the turn, so a delegated image-creation
  agent's output is covered automatically (the delegate flow already merges peer
  artifacts into `res.artifacts`).

## Approach

Add one neutral upload primitive to the provider abstraction and have the
generic connector drive it from `res.artifacts`. The connector stays
provider-agnostic; the orchestrator owns the artifact→bytes resolution it
already has guards for. `AgentRuntime` is unchanged.

### 1. `ChatClient.sendFile` — new provider primitive

In `packages/server/src/integrations/chat/chat-client.ts`:

```ts
/** A file to upload to a channel/room (image rendered inline, others attached). */
export interface OutboundFile {
  data: Buffer;
  filename: string;
  mimeType: string;
}
```

Add to the `ChatClient` interface:

```ts
/** Upload a file to a channel. Images render inline; other types attach. */
sendFile(channelId: string, file: OutboundFile): Promise<void>;
```

Per-provider implementations:

- **Slack** (`slack-client.ts`): `await this.web.files.uploadV2({ channel_id:
  channelId, file: file.data, filename: file.filename })`. Slack renders images
  inline and other types as attachments automatically.
- **Discord** (`discord-client.ts`): resolve the channel via the existing
  `channel(channelId)` helper, then `await ch.send({ files: [new
  AttachmentBuilder(file.data, { name: file.filename })] })`. Import
  `AttachmentBuilder` from `discord.js`.
- **Matrix** (`matrix-client.ts`): `const url = await
  this.client.uploadContent(file.data, file.mimeType, file.filename); const
  msgtype = file.mimeType.startsWith("image/") ? "m.image" : "m.file"; await
  this.client.sendMessage(channelId, { msgtype, url, body: file.filename, info:
  { mimetype: file.mimeType, size: file.data.length } })`.

`FakeChatClient` (`packages/server/src/test/fake-chat-client.ts`) implements
`sendFile` by recording calls into a `files: { channelId, file }[]` array.

### 2. `ChannelConnector` posts artifacts after the reply

In `packages/server/src/integrations/chat/channel-connector.ts`:

- Constructor gains a loader:
  `private readonly loadArtifact: (a: Artifact) => OutboundFile | null`.
- In the queued turn handler, after the existing text-reply post/edit, append:
  ```ts
  for (const artifact of res.artifacts) {
    let file: OutboundFile | null = null;
    try {
      file = this.loadArtifact(artifact);
    } catch (err) {
      console.warn(`[${this.platform}] artifact load failed for ${this.agentId}:`, err);
    }
    if (!file) continue;
    try {
      await this.client.sendFile(this.cfg.channelId, file);
    } catch (err) {
      console.warn(`[${this.platform}] file upload failed for ${this.agentId}:`, err);
    }
  }
  ```
- The text-reply path is **unchanged** (the `"(no response)"` fallback stays;
  image turns normally carry reply text, so the rare empty-text + image case is
  acceptable and not special-cased — YAGNI).

`RespondResult` already exposes `artifacts`; no runtime change.

### 3. Orchestrator injects the loader

In `packages/server/src/orchestrator/orchestrator.ts`, where it constructs each
`ChannelConnector` (in `reconcileOne`), pass a loader that resolves an artifact
to bytes from disk using the existing guarded resolvers:

```ts
(artifact: Artifact): OutboundFile | null => {
  const m = artifact.url.match(/\/agents\/([^/]+)\/(images|files)\/([^/?#]+)/);
  if (!m) return null;
  const [, agentId, kind, id] = m;
  if (kind === "images") {
    const path = this.agentImagePath(agentId, id);
    if (!path) return null;
    return { data: readFileSync(path), filename: artifact.name, mimeType: artifact.mimeType };
  }
  const resolved = this.agentFilePath(agentId, id);
  if (!resolved) return null;
  return { data: readFileSync(resolved.path), filename: artifact.name, mimeType: artifact.mimeType };
}
```

Parsing the `agentId` out of `artifact.url` (rather than assuming the connector's
own agent) is what lets a delegated peer's artifacts resolve. `readFileSync` is
already imported in the orchestrator.

## Files touched

- `packages/server/src/integrations/chat/chat-client.ts` — `OutboundFile` type +
  `sendFile` on the interface.
- `packages/server/src/integrations/chat/{slack,discord,matrix}-client.ts` —
  `sendFile` implementations.
- `packages/server/src/integrations/chat/channel-connector.ts` — loader
  constructor param + artifact-posting loop.
- `packages/server/src/orchestrator/orchestrator.ts` — inject the loader.
- `packages/server/src/test/fake-chat-client.ts` — recording `sendFile`.
- `packages/server/src/integrations/chat/channel-connector.test.ts` — new tests.

## Testing

- Extend `FakeChatClient` with `files[]` recording.
- `ChannelConnector` tests (network-free, via fake client + a stub loader):
  - A turn whose `res.artifacts` has an image and a file → after the text reply,
    `client.sendFile` is called once per artifact with the loaded bytes.
  - A turn with no artifacts → no `sendFile` calls (unchanged behavior).
  - `loadArtifact` returning `null` for an artifact → that artifact is skipped,
    others still post.
  - `sendFile` throwing → swallowed (warn), turn still completes.
- Provider `sendFile` implementations are network plumbing with no test harness
  (consistent with the existing `sendText`/`sendRich`); covered by build +
  manual smoke.
- Gate: `pnpm --filter @otterbot/{shared,server,web} build` clean; full server
  vitest suite green.

## Out of scope

- Agent-to-agent bus transport posting images.
- Image captions / prompt text on uploads.
- Any change to image generation, the artifact store, or `AgentRuntime`.
