import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createTestStack, type TestStack } from "../test/harness.js";

/**
 * End-to-end orchestrator tests against a fake OpenAI-compatible model server.
 * Exercises the full path: profiles → contexts → runtimes → bus → subagents.
 */
describe("orchestrator (e2e)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createTestStack();
  }, 30_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("boots with a COO agent registered", () => {
    const summaries = stack.orch.listSummaries();
    const coo = summaries.find((a) => a.id === "coo");
    expect(coo).toBeDefined();
    expect(coo?.role).toBe("coo");
  });

  it("runs a chat turn for the COO and streams a reply", async () => {
    stack.fake.setNextReply("Otters are playful semi-aquatic mammals.");
    const coo = stack.orch.getRuntime("coo");
    expect(coo).toBeDefined();
    const res = await coo!.respond({
      conversationId: "conv-1",
      userMessage: "what is an otter?",
      onChunk: () => {},
    });
    expect(res.finalText).toContain("playful semi-aquatic");
  });

  it("creates, updates, and deletes an agent", () => {
    const created = stack.orch.createAgent({ displayName: "Test Agent", persona: "tester" });
    expect(created.id).toBe("test-agent");
    expect(stack.orch.getRuntime("test-agent")).toBeDefined();

    const updated = stack.orch.updateAgent("test-agent", { displayName: "Renamed Agent" });
    expect(updated?.displayName).toBe("Renamed Agent");

    expect(stack.orch.deleteAgent("test-agent")).toBe(true);
    expect(stack.orch.getRuntime("test-agent")).toBeUndefined();
  });

  it("refuses to delete the COO", () => {
    expect(stack.orch.deleteAgent("coo")).toBe(false);
    expect(stack.orch.getRuntime("coo")).toBeDefined();
  });

  it("delivers a bus request to an agent and returns its response", async () => {
    stack.orch.createAgent({ displayName: "Echo Agent", persona: "echoes" });
    stack.fake.setNextReply("here is the delegated result");
    const reply = await stack.orch.getBus().request({
      id: nanoid(),
      kind: "request",
      from: "coo",
      to: "echo-agent",
      threadId: nanoid(),
      correlationId: null,
      rootSpawnId: null,
      body: "please handle this",
      transport: "local",
    });
    expect(reply.kind).toBe("response");
    expect(reply.from).toBe("echo-agent");
    expect(reply.body).toContain("delegated result");
  });

  it("spawns a subagent that runs to completion and reports back", async () => {
    stack.fake.setNextReply("subagent gathered three findings");
    const result = await stack.orch.spawnSubagent("coo", "research the otter habitat");
    expect(result.summary).toContain("subagent gathered");

    const task = stack.orch.listSubagentTasks().find((t) => t.id === result.taskId);
    expect(task?.status).toBe("done");
    expect(task?.parentAgentId).toBe("coo");

    const history = stack.orch.getBus().history(100);
    expect(history.some((m) => m.kind === "spawn")).toBe(true);
    expect(history.some((m) => m.kind === "report" && m.rootSpawnId === result.taskId)).toBe(true);
  });

  it("counts a parent's active subagents", () => {
    const coo = stack.orch.listSummaries().find((a) => a.id === "coo");
    expect((coo?.activeSubagents ?? 0)).toBeGreaterThan(0);
  });

  it("keeps each agent's memory in its own isolated database", async () => {
    const a = stack.orch.createAgent({ displayName: "Mem A" });
    const b = stack.orch.createAgent({ displayName: "Mem B" });
    stack.orch.getContext(a.id)!.memory.save({
      content: "the zephyr protocol runs on port 7000",
      importance: 8,
    });
    const aHits = await stack.orch.getContext(a.id)!.memory.search("zephyr");
    const bHits = await stack.orch.getContext(b.id)!.memory.search("zephyr");
    expect(aHits.length).toBeGreaterThan(0);
    expect(bHits.length).toBe(0);
  });

  it("enforces the subagent spawn limit", async () => {
    const parent = stack.orch.createAgent({ displayName: "Limited", subagentLimit: 0 });
    await expect(stack.orch.spawnSubagent(parent.id, "do work")).rejects.toThrow(/limit/);
  });
});
