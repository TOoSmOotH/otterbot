import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { nanoid } from "nanoid";
import { createTestStack, type TestStack } from "../test/harness.js";
import { buildAgentTools } from "../agent/tools.js";
import { getCatalogCapability } from "../skills/builtin-catalog.js";
import { buildSubagentProfile } from "./orchestrator.js";
import { normalizeProfile } from "../profiles/profile-store.js";
import type { AgentServices } from "../runtime/agent-services.js";

/** Poll `fn` until it returns true, or throw after `timeoutMs`. */
async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

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

  it("creates, updates, and deletes an agent", async () => {
    const created = stack.orch.createAgent({ displayName: "Test Agent", persona: "tester" });
    expect(created.id).toBe("test-agent");
    expect(stack.orch.getRuntime("test-agent")).toBeDefined();

    const updated = stack.orch.updateAgent("test-agent", { displayName: "Renamed Agent" });
    expect(updated?.displayName).toBe("Renamed Agent");

    expect(await stack.orch.deleteAgent("test-agent")).toBe(true);
    expect(stack.orch.getRuntime("test-agent")).toBeUndefined();
  });

  it("refuses to delete the COO", async () => {
    expect(await stack.orch.deleteAgent("coo")).toBe(false);
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
    "spawns a subagent that runs to completion, reports back, then is torn down",
    async () => {
      stack.cfg.subagentGraceMs = 0; // remove inline so we can assert immediately
      const result = await stack.orch.spawnSubagent("coo", "Briefly note one fact.");
      expect(result.summary.trim().length).toBeGreaterThan(0);

      // The audit trail survives the teardown.
      const task = stack.orch.listSubagentTasks().find((t) => t.id === result.taskId);
      expect(task?.status).toBe("done");
      expect(task?.parentAgentId).toBe("coo");

      const history = stack.orch.getBus().history(100);
      expect(history.some((m) => m.kind === "spawn")).toBe(true);
      expect(history.some((m) => m.kind === "report" && m.rootSpawnId === result.taskId)).toBe(true);

      // The ephemeral subagent itself is gone — runtime, roster entry, profile dir.
      expect(stack.orch.getContext(result.subagentId)).toBeUndefined();
      expect(stack.orch.listSummaries().some((a) => a.id === result.subagentId)).toBe(false);
      expect(existsSync(stack.profiles.pathsFor(result.subagentId).dir)).toBe(false);
    },
    60_000
  );

  it(
    "keeps a spawned subagent alive during its grace window, then removes it",
    async () => {
      stack.cfg.subagentGraceMs = 100; // short grace so the timer fires within the test
      // Parent: web search on, a tool-bearing capability installed.
      const parent = stack.orch.createAgent({
        displayName: "Capable Parent",
        canSpawnSubagents: true,
      });
      stack.orch.updateAgent(parent.id, { canWebSearch: true });
      const parentCtx = stack.orch.getContext(parent.id)!;
      const entry = getCatalogCapability("agentic-browsing")!;
      const { meta, body, enabled } = parentCtx.skills.parseSkillFile(entry.markdown);
      parentCtx.skills.create({ meta, body, enabled, source: "builtin" }, { id: entry.id });

      const result = await stack.orch.spawnSubagent(parent.id, "Look something up.");

      // Still alive in the grace window — and its inherited capabilities loaded.
      const subCtx = stack.orch.getContext(result.subagentId)!;
      expect(subCtx).toBeDefined();
      expect(subCtx.profile.canWebSearch).toBe(true);
      expect(subCtx.profile.canSpawnSubagents).toBe(false);
      // The installed capability and its granted tools came along (skills copied + loaded).
      expect(subCtx.skills.effectiveTools().has("browser_navigate")).toBe(true);

      // Once the grace timer fires it is fully removed.
      await waitFor(() => stack.orch.getContext(result.subagentId) === undefined);
      expect(stack.orch.listSummaries().some((a) => a.id === result.subagentId)).toBe(false);
      expect(existsSync(stack.profiles.pathsFor(result.subagentId).dir)).toBe(false);
    },
    60_000
  );

  it("buildSubagentProfile inherits the parent's capability fields", () => {
    const parent = normalizeProfile({
      id: "cap-parent",
      displayName: "Cap Parent",
      canWebSearch: true,
      canRunShell: true,
      allowedPeers: [{ agentId: "coo", shareMemory: false }],
    });
    const sub = buildSubagentProfile(parent, {
      id: "cap-parent__sub__1",
      displayName: "Cap Parent · sub 1",
      createdAt: new Date().toISOString(),
    });
    expect(sub.role).toBe("subagent");
    expect(sub.parentId).toBe("cap-parent");
    expect(sub.canWebSearch).toBe(true);
    expect(sub.canRunShell).toBe(true);
    expect(sub.allowedPeers).toEqual([{ agentId: "coo", shareMemory: false }]);
    expect(sub.model.chat).toEqual(parent.model.chat);
    // Subagents never spawn their own subagents.
    expect(sub.canSpawnSubagents).toBe(false);
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

  it("stores agent credentials in the encrypted secrets store", async () => {
    const agent = stack.orch.createAgent({ displayName: "Cred Agent" });
    stack.orch.mergeCredentials(agent.id, { ANTHROPIC_API_KEY: "sk-test-xyz" });
    expect(stack.orch.getSecrets().get(agent.id).get("ANTHROPIC_API_KEY")).toBe("sk-test-xyz");
    // Merging a second credential leaves the first one intact.
    stack.orch.mergeCredentials(agent.id, { GITHUB_TOKEN: "ghp-test" });
    expect(stack.orch.listCredentials(agent.id)?.map((c) => c.key)).toEqual([
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
    ]);
    // Deleting one credential leaves the rest intact.
    stack.orch.deleteCredential(agent.id, "GITHUB_TOKEN");
    expect(stack.orch.listCredentials(agent.id)?.map((c) => c.key)).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
    // Deleting the agent clears its secrets.
    await stack.orch.deleteAgent(agent.id);
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

  it("enforces agent-to-agent messaging and memory permissions", async () => {
    const research = stack.orch.createAgent({ displayName: "Research Bot" });
    const worker = stack.orch.createAgent({
      displayName: "Worker Bot",
      allowedPeers: [{ agentId: research.id, shareMemory: true }],
    });
    const stranger = stack.orch.createAgent({ displayName: "Stranger Bot" });

    // allowedPeers round-trips through createAgent + the profile store.
    expect(stack.orch.getContext(worker.id)!.profile.allowedPeers).toEqual([
      { agentId: research.id, shareMemory: true },
    ]);

    stack.orch.getContext(research.id)!.memory.save({
      content: "the falcon protocol uses port 9000",
      importance: 8,
    });

    const services = {
      bus: { request: async (m: { body: string }) => ({ ...m, kind: "response" }) },
      listAgents: () =>
        stack.orch
          .listSummaries()
          .map((s) => ({ id: s.id, displayName: s.displayName, role: s.role, summary: "" })),
      spawnSubagent: async () => {
        throw new Error("unused");
      },
      scheduleTask: () => null,
      listScheduledTasks: () => [],
      cancelScheduledTask: () => false,
      searchPeerMemory: (id: string, query: string, limit: number) =>
        stack.orch.getContext(id)!.memory.search(query, { limit }),
    } as unknown as AgentServices;

    const opts = {} as never;
    const workerTools = buildAgentTools(stack.orch.getContext(worker.id)!, services);
    const researchTools = buildAgentTools(stack.orch.getContext(research.id)!, services);
    const cooTools = buildAgentTools(stack.orch.getContext("coo")!, services);

    // The research agent has no peers — it gets neither coordination tool.
    expect(researchTools.delegate).toBeUndefined();
    expect(researchTools.search_peer_memory).toBeUndefined();
    // The worker (granted) and the COO (bypasses) both get them.
    expect(workerTools.delegate).toBeDefined();
    expect(workerTools.search_peer_memory).toBeDefined();
    expect(cooTools.delegate).toBeDefined();

    // The worker may message its permitted peer but not an arbitrary agent.
    const allowed = await workerTools.delegate!.execute!(
      { agentId: research.id, task: "hi" },
      opts
    );
    expect(allowed).toMatchObject({ ok: true });
    const denied = await workerTools.delegate!.execute!(
      { agentId: stranger.id, task: "hi" },
      opts
    );
    expect(denied).toMatchObject({ ok: false });

    // The worker may read its peer's memory; the COO may read anyone's.
    const peerHits = (await workerTools.search_peer_memory!.execute!(
      { agentId: research.id, query: "falcon", limit: 6 },
      opts
    )) as { ok: boolean; hits: unknown[] };
    expect(peerHits.ok).toBe(true);
    expect(peerHits.hits.length).toBeGreaterThan(0);

    const cooHits = (await cooTools.search_peer_memory!.execute!(
      { agentId: research.id, query: "falcon", limit: 6 },
      opts
    )) as { ok: boolean; hits: unknown[] };
    expect(cooHits.ok).toBe(true);
    expect(cooHits.hits.length).toBeGreaterThan(0);
  });
});
