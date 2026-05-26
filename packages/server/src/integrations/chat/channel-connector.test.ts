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
    expect(client.sent).toEqual([{ channelId: "C1", text: "echo:hi there", threadId: "M1" }]);
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
    expect(client.sent).toEqual([{ channelId: "C1", text: "Error: boom", threadId: "M1" }]);
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
    expect(client.sent).toEqual([{ channelId: "C1", text: "here", threadId: "M1" }]);
    expect(client.files.map((f) => f.file.filename)).toEqual(["cat.png", "report.pdf"]);
    expect(client.files[0].channelId).toBe("C1");
    expect(client.files[0].threadId).toBe("M1");
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

  it("on a failed file upload, posts a fallback note and marks the connector errored", async () => {
    const client = new FakeChatClient(false);
    client.sendFile = async () => {
      throw new Error("missing_scope");
    };
    const conn = make(client, cfg(), runtimeWithArtifacts([artifact({ name: "cat.png" })]));
    await conn.start();
    conn.markConnected();
    client.emit({ text: "go" });
    await expect(conn.whenIdle()).resolves.toBeUndefined();
    // The reply plus a human-readable fallback naming the artifact and reason.
    expect(client.sent.length).toBe(2);
    const fallback = client.sent[1].text;
    expect(fallback).toContain("cat.png");
    expect(fallback).toContain("missing_scope");
    expect(fallback).toContain("files:write");
    expect(conn.getStatus().state).toBe("error");
  });

  it("posts a fallback note when an artifact cannot be loaded", async () => {
    const client = new FakeChatClient(false);
    const conn = make(client, cfg(), runtimeWithArtifacts([artifact({ name: "doc.pdf" })]), () => null);
    await conn.start();
    client.emit({ text: "go" });
    await conn.whenIdle();
    expect(client.files).toEqual([]);
    expect(client.sent[1]?.text).toContain("doc.pdf");
  });

  it("clears context on a !clear command instead of running an agent turn", async () => {
    const client = new FakeChatClient(false);
    const resets: string[] = [];
    const calls: string[] = [];
    const runtime = {
      respond: async ({ userMessage }: { userMessage: string }) => {
        calls.push(userMessage);
        return { finalText: `echo:${userMessage}` };
      },
      resetConversation: (id: string) => resets.push(id),
    } as never;
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "!clear" });
    await conn.whenIdle();
    expect(resets).toEqual(["test-C1-M1"]);
    expect(calls).toEqual([]); // no agent turn for a command
    expect(client.sent.length).toBe(1);
    expect(client.sent[0].text).toContain("cleared");
    expect(client.sent[0].text).toContain("memory kept");
  });

  it("treats a mention-prefixed '!clear' as the clear command", async () => {
    const client = new FakeChatClient(false);
    const resets: string[] = [];
    const runtime = {
      respond: async () => ({ finalText: "x" }),
      resetConversation: (id: string) => resets.push(id),
    } as never;
    const conn = make(client, cfg({ mentionOnly: true }), runtime);
    await conn.start();
    client.emit({ text: "Otter Bot: !clear", mentioned: true });
    await conn.whenIdle();
    expect(resets).toEqual(["test-C1-M1"]);
  });

  it("does NOT wipe on a chat !reset — replies that full reset is web-only", async () => {
    const client = new FakeChatClient(false);
    const resets: string[] = [];
    const runtime = {
      respond: async () => ({ finalText: "x" }),
      resetConversation: (id: string) => resets.push(id),
    } as never;
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "!reset" });
    await conn.whenIdle();
    expect(resets).toEqual([]); // chat !reset never clears anything
    expect(client.sent.length).toBe(1);
    expect(client.sent[0].text).toContain("web app");
  });

  it("reports context usage on a !context command", async () => {
    const client = new FakeChatClient(false);
    const runtime = {
      respond: async () => ({ finalText: "x" }),
      contextStatus: () => ({
        budgetTokens: 1000,
        usedTokens: 250,
        recapTokens: 0,
        verbatimTokens: 250,
        messageCount: 4,
        compactedMessageCount: 0,
        overBudget: false,
        lastCompactedAt: null,
      }),
    } as never;
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "!context" });
    await conn.whenIdle();
    expect(client.sent.length).toBe(1);
    expect(client.sent[0].text).toContain("250 / 1,000 tokens (25%)");
    expect(client.sent[0].text).toContain("4 messages");
  });

  it("clears a prior error state after a later successful post", async () => {
    const client = new FakeChatClient(false);
    const conn = make(client, cfg(), runtimeWithArtifacts([]));
    await conn.start();
    conn.markError("boom");
    expect(conn.getStatus().state).toBe("error");
    client.emit({ text: "hi" });
    await conn.whenIdle();
    expect(conn.getStatus().state).toBe("connected");
  });

  // --- Threading ---------------------------------------------------------
  /** Records the conversationId of each turn. */
  function convRuntime(convs: string[] = []) {
    return {
      convs,
      runtime: {
        respond: async ({ conversationId }: { conversationId: string }) => {
          convs.push(conversationId);
          return { finalText: "ok" };
        },
      } as never,
    };
  }

  it("a top-level message replies in a new thread rooted at the message", async () => {
    const client = new FakeChatClient(false);
    const { runtime, convs } = convRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "hi", messageId: "T1" });
    await conn.whenIdle();
    // The reply is posted into the thread keyed by the message's own id.
    expect(client.sent).toEqual([{ channelId: "C1", text: "ok", threadId: "T1" }]);
    expect(convs).toEqual(["test-C1-T1"]);
  });

  it("an in-thread message continues that thread's conversation", async () => {
    const client = new FakeChatClient(false);
    const { runtime, convs } = convRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    // A reply inside an existing thread carries the thread root as threadId.
    client.emit({ text: "more", messageId: "T2", threadId: "T1" });
    await conn.whenIdle();
    expect(client.sent).toEqual([{ channelId: "C1", text: "ok", threadId: "T1" }]);
    expect(convs).toEqual(["test-C1-T1"]);
  });

  it("two top-level messages get independent conversations", async () => {
    const client = new FakeChatClient(false);
    const { runtime, convs } = convRuntime();
    const conn = make(client, cfg(), runtime);
    await conn.start();
    client.emit({ text: "one", messageId: "A" });
    client.emit({ text: "two", messageId: "B" });
    await conn.whenIdle();
    expect(convs).toEqual(["test-C1-A", "test-C1-B"]);
  });

  it("with mentionOnly, answers in-thread follow-ups without a re-mention", async () => {
    const client = new FakeChatClient(false);
    const { runtime, convs } = convRuntime();
    const conn = make(client, cfg({ mentionOnly: true }), runtime);
    await conn.start();
    // A top-level message without a mention is ignored.
    client.emit({ text: "ignored", messageId: "T1", mentioned: false });
    await conn.whenIdle();
    expect(convs).toEqual([]);
    // Mentioning the bot starts a thread the bot is now active in.
    client.emit({ text: "hello", messageId: "T2", mentioned: true });
    await conn.whenIdle();
    expect(convs).toEqual(["test-C1-T2"]);
    // A follow-up in that thread is answered though it isn't a mention.
    client.emit({ text: "follow up", messageId: "T3", threadId: "T2", mentioned: false });
    await conn.whenIdle();
    expect(convs).toEqual(["test-C1-T2", "test-C1-T2"]);
    // But an unrelated thread the bot never joined stays ignored.
    client.emit({ text: "other", messageId: "T4", threadId: "X9", mentioned: false });
    await conn.whenIdle();
    expect(convs).toEqual(["test-C1-T2", "test-C1-T2"]);
  });
});
