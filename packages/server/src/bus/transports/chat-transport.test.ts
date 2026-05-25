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
    client.emit({ channelId: "C1", fromSelf: true, text: "hello" });
    client.emit({ channelId: "OTHER", text: "x" });
    client.emit({ channelId: "C1", text: "   " });
    expect(received).toEqual([]);
  });

  it("swallows a failed send instead of throwing (bus stays alive)", async () => {
    const client = new FakeChatClient();
    client.sendRich = async () => {
      throw new Error("network down");
    };
    const t = new ChatProviderTransport("discord", client, "C1");
    await expect(t.send(msg())).resolves.toBeUndefined();
  });
});
