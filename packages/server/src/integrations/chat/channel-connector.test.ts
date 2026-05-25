import { describe, it, expect } from "vitest";
import type { ChannelBotConfig } from "@otterbot/shared";
import type { Artifact } from "@otterbot/shared";
import type { OutboundFile } from "./chat-client.js";
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

  it("drops the message (no send, no throw) when no runtime is available", async () => {
    const client = new FakeChatClient(false);
    const conn = new ChannelConnector("test", "agent-1", cfg(), client, () => undefined);
    await conn.start();
    client.emit({ text: "hi" });
    await conn.whenIdle();
    expect(client.sent).toEqual([]);
    expect(client.edits).toEqual([]);
  });

  it("surfaces a runtime error as the reply instead of throwing", async () => {
    const client = new FakeChatClient(false);
    const runtime = {
      respond: async () => {
        throw new Error("boom");
      },
    } as never;
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "hi" });
    await conn.whenIdle();
    expect(client.sent).toEqual([{ channelId: "C1", text: "Error: boom" }]);
  });

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
});
