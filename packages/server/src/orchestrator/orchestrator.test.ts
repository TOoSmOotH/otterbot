import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createTestStack, type TestStack } from "../test/harness.js";

/**
 * End-to-end orchestrator tests. Run against a fake model by default, or a
 * real model when OTTER_TEST_MODEL_URL / OTTER_TEST_MODEL are set. Assertions
 * check structure and non-emptiness, never exact content, so they hold either
 * way. Exercises the full path: profiles → contexts → runtimes → bus → subagents.
 */
describe("orchestrator (e2e)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createTestStack();
  }, 60_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("boots with a COO agent registered", () => {
    const coo = stack.orch.listSummaries().find((a) => a.id === "coo");
    expect(coo).toBeDefined();
    expect(coo?.role).toBe("coo");
  });

  it(
    "runs a chat turn for the COO and streams a non-empty reply",
    async () => {
      const coo = stack.orch.getRuntime("coo");
      expect(coo).toBeDefined();
      const res = await coo!.respond({
        conversationId: "conv-1",
        userMessage: "Say hello in one short sentence.",
        onChunk: () => {},
      });
      expect(res.finalText.trim().length).toBeGreaterThan(0);
    },
    60_000
  );

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

  it(
    "delivers a bus request to an agent and returns its response",
    async () => {
      stack.orch.createAgent({ displayName: "Echo Agent", persona: "echoes" });
      const reply = await stack.orch.getBus().request({
        id: nanoid(),
        kind: "request",
        from: "coo",
        to: "echo-agent",
        threadId: nanoid(),
        correlationId: null,
        rootSpawnId: null,
        body: "Briefly say anything.",
        transport: "local",
      });
      expect(reply.kind).toBe("response");
      expect(reply.from).toBe("echo-agent");
      expect(reply.body.trim().length).toBeGreaterThan(0);
    },
    60_000
  );

  it(
    "spawns a subagent that runs to completion and reports back",
    async () => {
      const result = await stack.orch.spawnSubagent("coo", "Briefly note one fact.");
      expect(result.summary.trim().length).toBeGreaterThan(0);

      const task = stack.orch.listSubagentTasks().find((t) => t.id === result.taskId);
      expect(task?.status).toBe("done");
      expect(task?.parentAgentId).toBe("coo");

      const history = stack.orch.getBus().history(100);
      expect(history.some((m) => m.kind === "spawn")).toBe(true);
      expect(history.some((m) => m.kind === "report" && m.rootSpawnId === result.taskId)).toBe(true);
    },
    60_000
  );

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

  it("stores agent credentials in the encrypted secrets store", () => {
    const agent = stack.orch.createAgent({ displayName: "Cred Agent" });
    stack.orch.setCredentials(agent.id, { ANTHROPIC_API_KEY: "sk-test-xyz" });
    expect(stack.orch.getSecrets().get(agent.id).get("ANTHROPIC_API_KEY")).toBe("sk-test-xyz");
    // Deleting the agent clears its secrets.
    stack.orch.deleteAgent(agent.id);
    expect(stack.orch.getSecrets().hasAny(agent.id)).toBe(false);
  });

  it("enforces the subagent spawn limit", async () => {
    const parent = stack.orch.createAgent({ displayName: "Limited", subagentLimit: 0 });
    await expect(stack.orch.spawnSubagent(parent.id, "do work")).rejects.toThrow(/limit/);
  });

  it("persists and reads back app settings", () => {
    stack.orch.setSetting("onboarding_complete", "true");
    expect(stack.orch.getSetting("onboarding_complete")).toBe("true");
    expect(stack.orch.getSetting("missing-key")).toBeNull();
  });
});
