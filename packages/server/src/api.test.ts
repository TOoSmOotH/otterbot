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
});
