import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestStack, type TestStack } from "./test/harness.js";
import { buildServer } from "./server.js";

/** End-to-end HTTP API tests — exercises the real Fastify routes via inject(). */
describe("HTTP API (e2e)", () => {
  let stack: TestStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stack = await createTestStack();
    app = await buildServer(stack.orch, stack.cfg);
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await stack.cleanup();
  });

  it("GET /api/agents lists agents including the COO", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(body.some((a) => a.id === "coo")).toBe(true);
  });

  it("POST /api/agents creates an agent; missing name is rejected", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: { displayName: "Api Agent" },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { id: string }).id).toBe("api-agent");

    const bad = await app.inject({ method: "POST", url: "/api/agents", payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it("GET /api/agents/:id returns a profile or 404s", async () => {
    const found = await app.inject({ method: "GET", url: "/api/agents/coo" });
    expect(found.statusCode).toBe(200);
    expect((found.json() as { role: string }).role).toBe("coo");

    const missing = await app.inject({ method: "GET", url: "/api/agents/does-not-exist" });
    expect(missing.statusCode).toBe(404);
  });

  it("PATCH /api/agents/:id updates the profile", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Patch Me" } });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/agents/patch-me",
      payload: { persona: "an updated persona" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { persona: string }).persona).toBe("an updated persona");
  });

  it("manages per-agent skills (add, list, delete)", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Skill Agent" } });

    const add = await app.inject({
      method: "POST",
      url: "/api/agents/skill-agent/skills",
      payload: { name: "Greeting Skill", body: "Step 1. Say hello." },
    });
    expect(add.statusCode).toBe(200);
    const skillId = (add.json() as { id: string }).id;

    const list = await app.inject({ method: "GET", url: "/api/agents/skill-agent/skills" });
    expect((list.json() as unknown[]).length).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/agents/skill-agent/skills/${skillId}`,
    });
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/agents/skill-agent/skills" });
    expect((after.json() as unknown[]).length).toBe(0);
  });

  it("manages scheduled tasks (add valid, reject invalid, delete)", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Sched Agent" } });

    const add = await app.inject({
      method: "POST",
      url: "/api/agents/sched-agent/scheduled-tasks",
      payload: { cron: "0 9 * * *", prompt: "morning report" },
    });
    expect(add.statusCode).toBe(200);
    const taskId = (add.json() as { id: string }).id;

    const bad = await app.inject({
      method: "POST",
      url: "/api/agents/sched-agent/scheduled-tasks",
      payload: { cron: "not-a-cron", prompt: "x" },
    });
    expect(bad.statusCode).toBe(400);

    const del = await app.inject({ method: "DELETE", url: `/api/scheduled-tasks/${taskId}` });
    expect(del.statusCode).toBe(200);
  });

  it("GET /api/providers lists model providers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    const body = res.json() as Array<{ id: string }>;
    expect(body.some((p) => p.id === "anthropic")).toBe(true);
    expect(body.some((p) => p.id === "lmstudio")).toBe(true);
  });

  it("stores global settings and redacts provider API keys", async () => {
    const update = await app.inject({
      method: "PUT",
      url: "/api/settings/global",
      payload: {
        theme: "forest",
        defaultChatModel: { provider: "openai", modelId: "gpt-4o" },
        defaultEmbeddingModel: { provider: "lmstudio", modelId: "nomic-embed-text" },
        providers: {
          anthropic: {
            baseUrl: "https://api.anthropic.com/v1",
            apiKeyConfigured: false,
          },
          openai: {
            baseUrl: "https://api.openai.com/v1",
            apiKeyConfigured: false,
            authMethod: "oauth",
            apiKey: "sk-test",
          },
          lmstudio: {
            baseUrl: stack.cfg.lmstudioBaseUrl,
            apiKeyConfigured: false,
          },
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            apiKeyConfigured: false,
          },
        },
      },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json() as {
      theme: string;
      defaultChatModel: { provider: string; modelId: string };
      providers: { openai: { apiKey?: string; apiKeyConfigured: boolean; authMethod?: string } };
    };
    expect(updated.theme).toBe("forest");
    expect(updated.defaultChatModel).toEqual({ provider: "openai", modelId: "gpt-4o" });
    expect(updated.providers.openai.apiKey).toBeUndefined();
    expect(updated.providers.openai.apiKeyConfigured).toBe(true);
    expect(updated.providers.openai.authMethod).toBe("oauth");
    expect(stack.orch.getGlobalProviderSecrets().get("OPENAI_API_KEY")).toBe("sk-test");
    expect(stack.orch.getGlobalProviderSecrets().get("OPENAI_AUTH_METHOD")).toBe("oauth");
  });

  it("GET /api/bus/messages and /api/subagent-tasks return arrays", async () => {
    const bus = await app.inject({ method: "GET", url: "/api/bus/messages" });
    expect(Array.isArray(bus.json())).toBe(true);
    const tasks = await app.inject({ method: "GET", url: "/api/subagent-tasks" });
    expect(Array.isArray(tasks.json())).toBe(true);
  });

  it("DELETE /api/agents/coo is refused", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/agents/coo" });
    expect(res.statusCode).toBe(400);
  });

  it("setup-state reports and updates onboarding status", async () => {
    const before = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { onboardingComplete: boolean }).onboardingComplete).toBe(false);

    await app.inject({ method: "POST", url: "/api/setup-state/complete" });

    const after = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect((after.json() as { onboardingComplete: boolean }).onboardingComplete).toBe(true);
  });

  it("test-model rejects a request missing provider/modelId", async () => {
    const res = await app.inject({ method: "POST", url: "/api/test-model", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it(
    "test-model verifies a working model connection",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/test-model",
        payload: { provider: "lmstudio", modelId: stack.cfg.model },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    },
    60_000
  );

  it("provider-models rejects a request missing provider", async () => {
    const res = await app.inject({ method: "POST", url: "/api/provider-models", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("provider-models lists the models a local server serves", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-models",
      payload: { provider: "lmstudio" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; models?: string[] };
    expect(body.ok).toBe(true);
    expect(body.models).toContain(stack.cfg.model);
  });

  it("GET /api/skill-catalog lists built-in and optional skills, omits hermes-agent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skill-catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string; category: string; pack: string }>;
    expect(body.length).toBeGreaterThan(120);
    expect(body.some((s) => s.id === "github-issues" && s.pack === "builtin")).toBe(true);
    expect(body.some((s) => s.id === "whisper" && s.pack === "optional")).toBe(true);
    expect(body.some((s) => s.id === "hermes-agent")).toBe(false);
    expect(body.every((s) => typeof s.category === "string" && s.category.length > 0)).toBe(true);
  });

  it("skill install rejects an unknown catalog id and a missing agent", async () => {
    const badSkill = await app.inject({
      method: "POST",
      url: "/api/agents/coo/skills/install",
      payload: { catalogId: "does-not-exist" },
    });
    expect(badSkill.statusCode).toBe(400);

    const badAgent = await app.inject({
      method: "POST",
      url: "/api/agents/nope/skills/install",
      payload: { catalogId: "github-issues" },
    });
    expect(badAgent.statusCode).toBe(404);
  });

  it("reports ChatGPT OAuth status (disconnected by default)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/openai/status" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { connected: boolean }).connected).toBe(false);
  });

  it("adds a memory manually and rejects empty content", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/agents/coo/memories",
      payload: { content: "   " },
    });
    expect(empty.statusCode).toBe(400);

    const added = await app.inject({
      method: "POST",
      url: "/api/agents/coo/memories",
      payload: { content: "The user's name is Mike.", category: "fact" },
    });
    expect(added.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/agents/coo/memories" });
    const body = list.json() as Array<{ content: string; source: string }>;
    expect(body.some((m) => m.content.includes("Mike") && m.source === "user")).toBe(true);
  });
});
