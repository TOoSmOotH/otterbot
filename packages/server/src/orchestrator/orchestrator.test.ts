import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createTestStack, type TestStack } from "../test/harness.js";
import { buildAgentTools } from "../agent/tools.js";
import { persistArtifact } from "../integrations/artifacts.js";
import * as schema from "../db/schema.js";
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
      // It shares the parent's SSH key dir rather than getting a throwaway key.
      expect(subCtx.sshDir).toBe(stack.profiles.pathsFor(parent.id).ssh);

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
      browseTimeoutMs: 120_000,
      maxSteps: 16,
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
    expect(sub.browseTimeoutMs).toBe(120_000);
    expect(sub.maxSteps).toBe(16);
  });

  // A request addressed to a service agent, for the dispatch tests below.
  const dispatchRequest = (to: string) => ({
    id: nanoid(),
    kind: "request" as const,
    from: "coo",
    to,
    threadId: nanoid(),
    correlationId: null,
    rootSpawnId: null,
    body: "Briefly say anything.",
    transport: "local" as const,
  });

  it(
    "dispatchToSubagent: a delegated request is answered by a non-blocking subagent",
    async () => {
      stack.cfg.subagentGraceMs = 0;
      const svc = stack.orch.createAgent({
        displayName: "Service Agent",
        canSpawnSubagents: true,
        dispatchToSubagent: true,
      });
      expect(stack.orch.getContext(svc.id)!.profile.dispatchToSubagent).toBe(true);

      const req = dispatchRequest(svc.id);
      const reply = await stack.orch.getBus().request(req);

      // The reply resolves the original request, but comes FROM a subagent —
      // the service agent's own serial queue is never engaged.
      expect(reply.kind).toBe("response");
      expect(reply.correlationId).toBe(req.id);
      expect(reply.from).toContain(`${svc.id}__sub__`);
      expect(reply.body.trim().length).toBeGreaterThan(0);

      // A subagent task was recorded under the service agent, then the
      // ephemeral subagent is torn down.
      const task = stack.orch
        .listSubagentTasks()
        .find((t) => t.parentAgentId === svc.id && t.subagentId === reply.from);
      expect(task?.status).toBe("done");

      // Completion is announced with a `report` (not just the correlated
      // `response`) so the UI's task list refreshes and the active-subagent
      // indicator clears without a manual page refresh.
      const history = stack.orch.getBus().history(100);
      expect(
        history.some((m) => m.kind === "report" && m.rootSpawnId === task!.rootId)
      ).toBe(true);

      await waitFor(() => stack.orch.getContext(reply.from!) === undefined);
    },
    60_000
  );

  it(
    "dispatchToSubagent: serves two concurrent requests from distinct subagents",
    async () => {
      stack.cfg.subagentGraceMs = 0;
      const svc = stack.orch.createAgent({
        displayName: "Parallel Service",
        canSpawnSubagents: true,
        dispatchToSubagent: true,
      });
      const bus = stack.orch.getBus();
      const a = dispatchRequest(svc.id);
      const b = dispatchRequest(svc.id);
      const [ra, rb] = await Promise.all([bus.request(a), bus.request(b)]);

      expect(ra.correlationId).toBe(a.id);
      expect(rb.correlationId).toBe(b.id);
      expect(ra.from).toContain(`${svc.id}__sub__`);
      expect(rb.from).toContain(`${svc.id}__sub__`);
      // Distinct subagents ran the two requests in parallel.
      expect(ra.from).not.toBe(rb.from);
    },
    60_000
  );

  it(
    "dispatchToSubagent: queues past subagentLimit and still answers every request",
    async () => {
      stack.cfg.subagentGraceMs = 0;
      const svc = stack.orch.createAgent({
        displayName: "Limited Service",
        canSpawnSubagents: true,
        dispatchToSubagent: true,
        subagentLimit: 1,
      });
      const bus = stack.orch.getBus();
      const reqs = [dispatchRequest(svc.id), dispatchRequest(svc.id), dispatchRequest(svc.id)];
      const replies = await Promise.all(reqs.map((r) => bus.request(r)));

      // Over-limit requests were queued and drained, not rejected — every one
      // gets a correlated, non-empty answer.
      reqs.forEach((r, i) => {
        expect(replies[i].correlationId).toBe(r.id);
        expect(replies[i].body.trim().length).toBeGreaterThan(0);
      });
    },
    60_000
  );

  it("delegate surfaces artifacts the peer returned on the response payload", async () => {
    const artifact = {
      id: "art_1.png",
      kind: "image" as const,
      url: "/api/agents/painter/files/art_1.png",
      name: "art_1.png",
      mimeType: "image/png",
      prompt: "an otter",
    };
    const services = {
      // A peer that replies with text plus a produced file on the payload.
      bus: {
        request: async (m: { body: string }) => ({
          ...m,
          kind: "response",
          body: "done",
          payload: { artifacts: [artifact] },
        }),
      },
      listAgents: () => [{ id: "painter", displayName: "Painter", role: "agent", summary: "" }],
    } as unknown as AgentServices;

    const cooTools = buildAgentTools(stack.orch.getContext("coo")!, services);
    const res = (await cooTools.delegate!.execute!(
      { agentId: "painter", task: "make art" },
      {} as never
    )) as { ok: boolean; kind: string; artifacts: unknown[] };
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("delegate");
    expect(res.artifacts).toEqual([artifact]);
  });

  it("delegate attaches docs as files and carries refs on the request payload", async () => {
    let captured: { payload?: { attachments?: Array<{ id: string; name: string; kind: string; mimeType: string }> } } | undefined;
    const services = {
      bus: {
        request: async (m: typeof captured & { body: string }) => {
          captured = m;
          return { ...m, kind: "response", body: "ok", payload: undefined };
        },
      },
      listAgents: () => [{ id: "painter", displayName: "Painter", role: "agent", summary: "" }],
    } as unknown as AgentServices;

    const cooTools = buildAgentTools(stack.orch.getContext("coo")!, services);
    const res = (await cooTools.delegate!.execute!(
      {
        agentId: "painter",
        task: "Paint per the brief.",
        attachments: [{ name: "brief.md", content: "# Big brief\nlots of detail here" }],
      },
      {} as never
    )) as { ok: boolean };
    expect(res.ok).toBe(true);

    // The request carried the attachment as a file reference on the payload …
    const atts = captured!.payload!.attachments!;
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ kind: "file", name: "brief.md" });
    expect(atts[0].mimeType).toContain("markdown");
    // … and the doc was written under the sending agent's files dir.
    const planted = stack.orch.readArtifact("coo", atts[0].id);
    expect(planted.ok).toBe(true);
    expect(planted.content).toContain("Big brief");
  });

  it("read_file reads a shared doc by reference and refuses traversal / binary", async () => {
    const doc = persistArtifact({
      filesDir: stack.profiles.pathsFor("coo").files,
      agentId: "coo",
      data: Buffer.from("hello from the doc"),
      name: "note.md",
      mimeType: "text/markdown; charset=utf-8",
    });
    const services = {
      readArtifact: (id: string, f: string) => stack.orch.readArtifact(id, f),
    } as unknown as AgentServices;
    const cooTools = buildAgentTools(stack.orch.getContext("coo")!, services);

    const ok = (await cooTools.read_file!.execute!({ path: doc.url }, {} as never)) as {
      ok: boolean;
      content?: string;
    };
    expect(ok.ok).toBe(true);
    expect(ok.content).toContain("hello from the doc");

    // An unrecognized reference is rejected by the tool itself.
    const bad = (await cooTools.read_file!.execute!({ path: "/not/a/file" }, {} as never)) as {
      ok: boolean;
    };
    expect(bad.ok).toBe(false);

    // The service guards traversal, missing files, and binary types.
    expect(stack.orch.readArtifact("coo", "../secret").ok).toBe(false);
    expect(stack.orch.readArtifact("coo", "missing.md").ok).toBe(false);
    const img = persistArtifact({
      filesDir: stack.profiles.pathsFor("coo").files,
      agentId: "coo",
      data: Buffer.from("PNGBYTES"),
      name: "pic.png",
    });
    expect(stack.orch.readArtifact("coo", img.id).ok).toBe(false);
  });

  it(
    "appends attachment references to a delegated request's user message",
    async () => {
      stack.orch.createAgent({ displayName: "Reader Agent", persona: "reads docs" });
      const threadId = nanoid();
      await stack.orch.getBus().request({
        id: nanoid(),
        kind: "request",
        from: "coo",
        to: "reader-agent",
        threadId,
        correlationId: null,
        rootSpawnId: null,
        body: "Summarize the attached brief.",
        payload: {
          attachments: [
            {
              id: "art_1.md",
              kind: "file",
              url: "/api/agents/coo/files/art_1.md",
              name: "brief.md",
              mimeType: "text/markdown",
            },
          ],
        },
        transport: "local",
      });

      // The receiver's first user message in the bus thread carries the ref block.
      const ctx = stack.orch.getContext("reader-agent")!;
      const userMsg = ctx.db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, `bus-${threadId}`))
        .all()
        .find((m) => m.role === "user");
      expect(userMsg?.content).toContain("Summarize the attached brief.");
      expect(userMsg?.content).toContain("read_file");
      expect(userMsg?.content).toContain("/api/agents/coo/files/art_1.md");
    },
    60_000
  );

  it("readArtifactBinary reads bytes and guards traversal / unknown agents", () => {
    const art = persistArtifact({
      filesDir: stack.profiles.pathsFor("coo").files,
      agentId: "coo",
      data: Buffer.from("PNGDATA"),
      name: "pic.png",
    });
    const bin = stack.orch.readArtifactBinary("coo", "files", art.id);
    expect(bin?.data.toString()).toBe("PNGDATA");
    expect(bin?.mimeType).toBe("image/png");
    expect(stack.orch.readArtifactBinary("coo", "files", "../secret")).toBeNull();
    expect(stack.orch.readArtifactBinary("no-such-agent", "files", art.id)).toBeNull();
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
