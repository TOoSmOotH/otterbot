# Post Agent Images & Files to Chat Connectors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a human chats with an agent in a Slack/Discord/Matrix channel and the turn produces image or file artifacts (directly or via a delegated image-creation agent), the connector posts those artifacts after its text reply.

**Architecture:** Add one neutral upload primitive `sendFile(channelId, OutboundFile)` to the `ChatClient` interface (implemented per provider). The generic `ChannelConnector` already receives `res.artifacts` from `AgentRuntime.respond()`; after posting the text reply it loads each artifact's bytes via an injected loader and calls `client.sendFile`. The orchestrator supplies the loader, resolving bytes from disk with its existing traversal-guarded `agentImagePath`/`agentFilePath`.

**Tech Stack:** TypeScript (Node ESM), Vitest, `@slack/web-api` (`files.uploadV2`), `discord.js` (`AttachmentBuilder`), `matrix-bot-sdk` (`uploadContent` + `sendMessage`).

**Spec:** `docs/superpowers/specs/2026-05-24-chat-image-posting-design.md`. **Scope:** connector role only; images + files; no captions; transport and `AgentRuntime` untouched.

---

### Task 1: Add the `sendFile` primitive across the ChatClient abstraction

Adding `sendFile` to the interface requires every implementer (3 real clients + the fake) to define it, so this is one cohesive commit. The build only goes green once all are present (final step).

**Files:**
- Modify: `packages/server/src/integrations/chat/chat-client.ts`
- Modify: `packages/server/src/test/fake-chat-client.ts`
- Modify: `packages/server/src/integrations/chat/slack-client.ts`
- Modify: `packages/server/src/integrations/chat/discord-client.ts`
- Modify: `packages/server/src/integrations/chat/matrix-client.ts`

- [ ] **Step 1: Add the `OutboundFile` type and `sendFile` to the interface**

In `chat-client.ts`, add the type (next to the other exported types) and the method on `ChatClient` (after `sendRich`):

```ts
/** A file to upload to a channel/room (image rendered inline, others attached). */
export interface OutboundFile {
  data: Buffer;
  filename: string;
  mimeType: string;
}
```

```ts
  /** Upload a file to a channel. Images render inline; other types attach. */
  sendFile(channelId: string, file: OutboundFile): Promise<void>;
```

- [ ] **Step 2: Implement it on `FakeChatClient`**

In `fake-chat-client.ts`, add `OutboundFile` to the type import from `../integrations/chat/chat-client.js`, add a recording array, and the method:

```ts
  files: { channelId: string; file: OutboundFile }[] = [];
```
```ts
  async sendFile(channelId: string, file: OutboundFile): Promise<void> {
    this.files.push({ channelId, file });
  }
```

- [ ] **Step 3: Implement `sendFile` on `SlackChatClient`**

In `slack-client.ts`, add `OutboundFile` to the type import from `./chat-client.js`, then add the method (alongside `sendRich`):

```ts
  async sendFile(channelId: string, file: OutboundFile): Promise<void> {
    await this.web.files.uploadV2({
      channel_id: channelId,
      file: file.data,
      filename: file.filename,
    });
  }
```

- [ ] **Step 4: Implement `sendFile` on `DiscordChatClient`**

In `discord-client.ts`, add `AttachmentBuilder` to the existing `discord.js` import and `OutboundFile` to the type import from `./chat-client.js`, then:

```ts
  async sendFile(channelId: string, file: OutboundFile): Promise<void> {
    const ch = await this.channel(channelId);
    if (!ch) return;
    await ch.send({ files: [new AttachmentBuilder(file.data, { name: file.filename })] });
  }
```

- [ ] **Step 5: Implement `sendFile` on `MatrixChatClient`**

In `matrix-client.ts`, add `OutboundFile` to the type import from `./chat-client.js`, then:

```ts
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
```

- [ ] **Step 6: Build (now green — all implementers defined)**

Run: `pnpm --filter @otterbot/server build`
Expected: clean tsc, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/integrations/chat/chat-client.ts \
        packages/server/src/test/fake-chat-client.ts \
        packages/server/src/integrations/chat/slack-client.ts \
        packages/server/src/integrations/chat/discord-client.ts \
        packages/server/src/integrations/chat/matrix-client.ts
git commit -m "feat(chat): add sendFile upload primitive to ChatClient + providers"
```

---

### Task 2: ChannelConnector posts artifacts after the reply (TDD)

**Files:**
- Modify: `packages/server/src/integrations/chat/channel-connector.ts`
- Modify: `packages/server/src/integrations/chat/channel-connector.test.ts`

- [ ] **Step 1: Write the failing tests**

In `channel-connector.test.ts`, add imports at the top (alongside the existing imports):

```ts
import type { Artifact } from "@otterbot/shared";
import type { OutboundFile } from "./chat-client.js";
```

Update the `make` helper to accept (and default) the new loader param. Replace the existing `make` function with:

```ts
const defaultLoader = (a: Artifact): OutboundFile => ({
  data: Buffer.from("bytes"),
  filename: a.name,
  mimeType: a.mimeType,
});

function make(
  client: FakeChatClient,
  c: ChannelBotConfig,
  runtime: unknown,
  loadArtifact: (a: Artifact) => OutboundFile | null = defaultLoader
) {
  return new ChannelConnector(
    "test",
    "agent-1",
    c,
    client,
    () => runtime as never,
    loadArtifact
  );
}
```

Add these test helpers and the four new tests inside the `describe("ChannelConnector", ...)` block:

```ts
function artifact(over: Partial<Artifact> = {}): Artifact {
  return {
    id: "art1",
    kind: "image",
    url: "/api/agents/a/images/art1",
    name: "art1.png",
    mimeType: "image/png",
    ...over,
  };
}

function runtimeWithArtifacts(artifacts: Artifact[]) {
  return { respond: async () => ({ finalText: "here", artifacts }) } as never;
}

it("uploads each artifact after posting the reply", async () => {
  const client = new FakeChatClient(false);
  const img = artifact({ id: "i1", name: "cat.png", url: "/api/agents/a/images/i1" });
  const doc = artifact({
    id: "d1",
    kind: "file",
    name: "report.pdf",
    url: "/api/agents/a/files/d1",
    mimeType: "application/pdf",
  });
  const conn = make(client, cfg(), runtimeWithArtifacts([img, doc]));
  await conn.start();
  client.emit({ text: "make stuff" });
  await conn.whenIdle();
  expect(client.sent).toEqual([{ channelId: "C1", text: "here" }]);
  expect(client.files.map((f) => f.file.filename)).toEqual(["cat.png", "report.pdf"]);
  expect(client.files[0].channelId).toBe("C1");
});

it("posts no files when the turn has no artifacts", async () => {
  const client = new FakeChatClient(false);
  const conn = make(client, cfg(), runtimeWithArtifacts([]));
  await conn.start();
  client.emit({ text: "hi" });
  await conn.whenIdle();
  expect(client.files).toEqual([]);
});

it("skips artifacts the loader cannot resolve", async () => {
  const client = new FakeChatClient(false);
  const ok = artifact({ name: "ok.png" });
  const missing = artifact({ id: "x", name: "missing.png", url: "/api/agents/a/images/x" });
  const loader = (a: Artifact): OutboundFile | null =>
    a.name === "missing.png"
      ? null
      : { data: Buffer.from("b"), filename: a.name, mimeType: a.mimeType };
  const conn = make(client, cfg(), runtimeWithArtifacts([ok, missing]), loader);
  await conn.start();
  client.emit({ text: "go" });
  await conn.whenIdle();
  expect(client.files.map((f) => f.file.filename)).toEqual(["ok.png"]);
});

it("swallows a failed file upload", async () => {
  const client = new FakeChatClient(false);
  client.sendFile = async () => {
    throw new Error("upload failed");
  };
  const conn = make(client, cfg(), runtimeWithArtifacts([artifact()]));
  await conn.start();
  client.emit({ text: "go" });
  await expect(conn.whenIdle()).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run the tests, confirm they FAIL**

Run: `pnpm --filter @otterbot/server test -- channel-connector`
Expected: FAIL — `ChannelConnector` constructor takes 5 args (TS arity error) and/or the new tests fail because artifacts aren't posted.

- [ ] **Step 3: Add the loader param + artifact loop to `ChannelConnector`**

In `channel-connector.ts`, add imports:

```ts
import type { Artifact } from "@otterbot/shared";
import type { ChatClient, InboundChatMessage, MessageHandle, OutboundFile } from "./chat-client.js";
```
(extend the existing `chat-client.js` type import to include `OutboundFile`, and add the `Artifact` import; `ChannelBotConfig`/`ConnectorState` stay as they are).

Add the constructor parameter (after `getRuntime`):

```ts
  constructor(
    private readonly platform: string,
    private readonly agentId: string,
    cfg: ChannelBotConfig,
    private readonly client: ChatClient,
    private readonly getRuntime: () => AgentRuntime | undefined,
    private readonly loadArtifact: (a: Artifact) => OutboundFile | null = () => null
  ) {
    this.cfg = cfg;
  }
```

The loader defaults to a no-op (`() => null`) so the orchestrator's current 5-argument construction still compiles after this task; Task 3 wires the real loader. With the default, connectors simply don't post files until then.

In `onInbound`, hoist the artifacts out of the try and post them after the reply. Replace the existing turn body (from `let reply: string;` through the reply post/edit `try/catch`) with:

```ts
      let reply: string;
      let artifacts: Artifact[] = [];
      try {
        const res = await runtime.respond({
          conversationId: `${this.platform}-${this.cfg.channelId}`,
          userMessage: body,
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
        artifacts = res.artifacts ?? [];
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
      for (const artifact of artifacts) {
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

- [ ] **Step 4: Run the tests, confirm they PASS**

Run: `pnpm --filter @otterbot/server test -- channel-connector`
Expected: PASS (the 9 existing tests + 4 new = 13).

- [ ] **Step 5: Build**

Run: `pnpm --filter @otterbot/server build`
Expected: clean. The optional loader default keeps the orchestrator's existing 5-arg construction valid; Task 3 wires the real loader.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/integrations/chat/channel-connector.ts \
        packages/server/src/integrations/chat/channel-connector.test.ts
git commit -m "feat(chat): connector posts turn artifacts after the reply"
```

---

### Task 3: Orchestrator injects the artifact loader + full gate

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Import `OutboundFile`**

In `orchestrator.ts`, add `OutboundFile` to the import from the chat-client module. Find the existing import of the generic connector:

```ts
import {
  ChannelConnector,
  connectorSignature,
} from "../integrations/chat/channel-connector.js";
```
and add below it:
```ts
import type { OutboundFile } from "../integrations/chat/chat-client.js";
```
(`Artifact` is already imported from `@otterbot/shared`; `readFileSync` is already imported from `node:fs`.)

- [ ] **Step 2: Add the loader method**

Add this private method to the `Orchestrator` class (near `agentImagePath` / `agentFilePath`):

```ts
  /** Resolve a turn artifact to bytes for upload to a chat channel. */
  private loadArtifactFile(artifact: Artifact): OutboundFile | null {
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

- [ ] **Step 3: Pass the loader when constructing the connector**

In `reconcileOne`, find:

```ts
    const connector = new ChannelConnector(provider.id, agentId, cfg, client, () =>
      this.runtimes.get(agentId)
    );
```
and replace with:

```ts
    const connector = new ChannelConnector(
      provider.id,
      agentId,
      cfg,
      client,
      () => this.runtimes.get(agentId),
      (artifact) => this.loadArtifactFile(artifact)
    );
```

- [ ] **Step 4: Full gate**

Run each; all must succeed:
```bash
pnpm --filter @otterbot/shared build
pnpm --filter @otterbot/server build
pnpm --filter @otterbot/web build
pnpm --filter @otterbot/server test
```
Expected: three clean builds; vitest green (168 existing + 4 new connector tests = 172).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts
git commit -m "feat(chat): orchestrator supplies artifact loader to connectors"
```

---

## Manual smoke checks (post-merge, require live accounts)

- In a Slack/Discord/Matrix channel the agent is connected to, ask it to generate an image. Confirm the text reply appears followed by the image rendered inline.
- Ask for something that delegates to a separate image-creation agent; confirm the delegated image still posts (loader resolves the peer agent's id from the artifact URL).
- If the agent produces a non-image file, confirm it posts as a downloadable attachment.
