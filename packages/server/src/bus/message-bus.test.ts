import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MessageBus } from "./message-bus.js";
import { migrateDb, resetDb } from "../db/index.js";
import { MessageType } from "@smoothbot/shared";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MessageBus", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "smoothbot-bus-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.SMOOTHBOT_DB_KEY = "test-key";
    migrateDb();
    bus = new MessageBus();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.SMOOTHBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("send", () => {
    it("returns a message with an id and timestamp", () => {
      const msg = bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "Hello COO",
      });
      expect(msg.id).toBeTruthy();
      expect(msg.timestamp).toBeTruthy();
      expect(msg.content).toBe("Hello COO");
    });

    it("persists the message to the database", () => {
      bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "Test persistence",
      });
      const history = bus.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("Test persistence");
    });
  });

  describe("routing", () => {
    it("delivers to the correct agent handler", () => {
      const handler = vi.fn();
      bus.subscribe("coo", handler);

      bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "Routed message",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].content).toBe("Routed message");
    });

    it("does not deliver to unsubscribed agents", () => {
      const handler = vi.fn();
      bus.subscribe("coo", handler);
      bus.unsubscribe("coo");

      bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "Should not arrive",
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("does not deliver to other agents", () => {
      const cooHandler = vi.fn();
      const otherHandler = vi.fn();
      bus.subscribe("coo", cooHandler);
      bus.subscribe("other", otherHandler);

      bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "Only for COO",
      });

      expect(cooHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("broadcast", () => {
    it("broadcasts all messages to broadcast handlers", () => {
      const broadcastHandler = vi.fn();
      bus.onBroadcast(broadcastHandler);

      bus.send({
        fromAgentId: "coo",
        toAgentId: "tl-1",
        type: MessageType.Directive,
        content: "Start project",
      });

      expect(broadcastHandler).toHaveBeenCalledOnce();
      expect(broadcastHandler.mock.calls[0][0].content).toBe("Start project");
    });

    it("can remove broadcast handlers", () => {
      const handler = vi.fn();
      bus.onBroadcast(handler);
      bus.offBroadcast(handler);

      bus.send({
        fromAgentId: "ceo",
        toAgentId: "coo",
        type: MessageType.Chat,
        content: "No broadcast",
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("returns all messages", () => {
      bus.send({ fromAgentId: "a", toAgentId: "b", type: MessageType.Chat, content: "1" });
      bus.send({ fromAgentId: "b", toAgentId: "a", type: MessageType.Chat, content: "2" });
      bus.send({ fromAgentId: "a", toAgentId: "c", type: MessageType.Directive, content: "3" });

      expect(bus.getHistory()).toHaveLength(3);
    });

    it("filters by agentId", () => {
      bus.send({ fromAgentId: "a", toAgentId: "b", type: MessageType.Chat, content: "1" });
      bus.send({ fromAgentId: "c", toAgentId: "d", type: MessageType.Chat, content: "2" });

      const history = bus.getHistory({ agentId: "a" });
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("1");
    });

    it("filters by projectId", () => {
      bus.send({ fromAgentId: "a", toAgentId: "b", type: MessageType.Chat, content: "1", projectId: "p1" });
      bus.send({ fromAgentId: "a", toAgentId: "b", type: MessageType.Chat, content: "2", projectId: "p2" });

      const history = bus.getHistory({ projectId: "p1" });
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe("1");
    });

    it("limits results", () => {
      for (let i = 0; i < 10; i++) {
        bus.send({ fromAgentId: "a", toAgentId: "b", type: MessageType.Chat, content: `msg-${i}` });
      }

      const history = bus.getHistory({ limit: 3 });
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe("msg-7");
    });
  });
});
