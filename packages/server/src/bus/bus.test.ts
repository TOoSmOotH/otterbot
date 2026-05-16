import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { MessageBus } from "./bus.js";
import { LocalTransport } from "./transports/local-transport.js";
import type { OutboundMessage } from "./bus.js";

function msg(over: Partial<OutboundMessage>): OutboundMessage {
  return {
    id: nanoid(),
    kind: "request",
    from: "a",
    to: "b",
    threadId: "t1",
    correlationId: null,
    rootSpawnId: null,
    body: "hello",
    transport: "local",
    ...over,
  };
}

describe("MessageBus", () => {
  let dir: string;
  let control: ControlDb;
  let bus: MessageBus;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-bus-"));
    control = openControlDb(join(dir, "control.db"));
    bus = new MessageBus(control, new LocalTransport());
  });

  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("publishes, assigns a monotonic seq, and persists to history", () => {
    const a = bus.publish(msg({ kind: "broadcast", to: null, body: "one" }));
    const b = bus.publish(msg({ kind: "broadcast", to: null, body: "two" }));
    expect(a.seq).toBeGreaterThan(0);
    expect(b.seq).toBeGreaterThan(a.seq);

    const history = bus.history();
    expect(history.map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("emits every published message to the UI hook", () => {
    const seen: string[] = [];
    bus.setEmit((m) => seen.push(m.body));
    bus.publish(msg({ body: "emitted" }));
    expect(seen).toContain("emitted");
  });

  it("delivers a message to its target agent", () => {
    const delivered: Array<{ to: string; body: string }> = [];
    bus.setDeliver((to, m) => delivered.push({ to, body: m.body }));
    bus.publish(msg({ to: "researcher", body: "task" }));
    expect(delivered).toEqual([{ to: "researcher", body: "task" }]);
  });

  it("routes broadcasts with a '*' target", () => {
    const targets: string[] = [];
    bus.setDeliver((to) => targets.push(to));
    bus.publish(msg({ kind: "broadcast", to: null }));
    expect(targets).toEqual(["*"]);
  });

  it("request() resolves when a correlated response is published", async () => {
    // A handler that answers every request synchronously.
    bus.setDeliver((_to, m) => {
      if (m.kind === "request") {
        bus.publish(
          msg({
            kind: "response",
            from: m.to ?? "b",
            to: m.from,
            correlationId: m.id,
            body: `re: ${m.body}`,
          })
        );
      }
    });
    const res = await bus.request(msg({ body: "ping" }));
    expect(res.kind).toBe("response");
    expect(res.body).toBe("re: ping");
  });

  it("request() rejects on timeout when no response arrives", async () => {
    await expect(bus.request(msg({ body: "noreply" }), 80)).rejects.toThrow(/timed out/);
  });
});
