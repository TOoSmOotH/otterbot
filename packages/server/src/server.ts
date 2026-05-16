import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { Config } from "./config.js";
import type { Orchestrator, CreateAgentInput } from "./orchestrator/orchestrator.js";
import { PROVIDERS } from "./providers/types.js";
import { registerDesktopProxy } from "./desktop/desktop.js";
import { getSkillService } from "./skills/skill-service.js";
import { getMemoryService } from "./memory/memory-service.js";
import { getUserProfileService } from "./user-profile/user-profile-service.js";
import { discoverModelPacks } from "./views/model-packs.js";
import { discoverSceneConfigs } from "./views/scene-configs.js";
import { discoverEnvironmentPacks } from "./views/environment-packs.js";
import { importSkillFromRaw, importSkillFromUrl, exportAllSkills } from "./skills/skill-hub.js";
import { generateText } from "ai";
import { resolveChatModel } from "./providers/registry.js";
import type { AgentProfile, ProviderId } from "@otterbot/shared";

/**
 * Build the Fastify HTTP API over a booted `Orchestrator`. Does not call
 * `listen()` — `index.ts` does that for the real process, while tests use
 * `app.inject()`.
 */
export async function buildServer(orch: Orchestrator, cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: cfg.logLevel } });

  await app.register(fastifyCors, { origin: true, credentials: true });

  // Static assets (3D models, textures) under /assets/3d/*
  if (existsSync(cfg.assetsDir)) {
    await app.register(fastifyStatic, {
      root: cfg.assetsDir,
      prefix: "/assets/3d/",
      decorateReply: false,
    });
  } else {
    app.log.warn(`assets dir not found (${cfg.assetsDir}); /assets/3d will 404`);
  }

  // Serve noVNC bundle, if installed.
  const novncDir = resolve(process.cwd(), "node_modules/@novnc/novnc");
  if (existsSync(novncDir)) {
    await app.register(fastifyStatic, {
      root: novncDir,
      prefix: "/novnc/",
      decorateReply: false,
    });
  }

  // --- Views (model packs / scenes / environment packs) ---
  app.get("/api/model-packs", async () => discoverModelPacks(cfg.assetsDir));
  app.get("/api/scenes", async () => discoverSceneConfigs(cfg.assetsDir));
  app.get("/api/environment-packs", async () => discoverEnvironmentPacks(cfg.assetsDir));

  // --- Providers (for the model picker) ---
  app.get("/api/providers", async () => PROVIDERS);

  // --- Setup / onboarding ---
  app.get("/api/setup-state", async () => ({
    onboardingComplete: orch.getSetting("onboarding_complete") === "true",
    agentCount: orch.listSummaries().length,
  }));

  app.post("/api/setup-state/complete", async () => {
    orch.setSetting("onboarding_complete", "true");
    return { ok: true };
  });

  // Verify a provider/model/credential combination before saving it.
  app.post<{
    Body: { provider?: ProviderId; modelId?: string; secrets?: Record<string, string> };
  }>("/api/test-model", async (req, reply) => {
    const { provider, modelId, secrets } = req.body ?? {};
    if (!provider || !modelId) {
      reply.code(400);
      return { ok: false, error: "provider and modelId are required" };
    }
    try {
      const model = resolveChatModel(
        { provider, modelId },
        new Map(Object.entries(secrets ?? {}))
      );
      const { text } = await generateText({
        model,
        prompt: "Reply with exactly the word: ready",
        maxTokens: 24,
      });
      return { ok: true, sample: text.trim().slice(0, 120) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- Agents ---
  app.get("/api/agents", async () => orch.listSummaries());

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.profile;
  });

  app.post<{ Body: CreateAgentInput }>("/api/agents", async (req, reply) => {
    if (!req.body?.displayName) {
      reply.code(400);
      return { error: "displayName is required" };
    }
    return orch.createAgent(req.body);
  });

  app.patch<{ Params: { id: string }; Body: Partial<AgentProfile> }>(
    "/api/agents/:id",
    async (req, reply) => {
      const updated = orch.updateAgent(req.params.id, req.body ?? {});
      if (!updated) {
        reply.code(404);
        return { error: "not found" };
      }
      return updated;
    }
  );

  app.delete<{ Params: { id: string } }>("/api/agents/:id", async (req, reply) => {
    const ok = orch.deleteAgent(req.params.id);
    if (!ok) {
      reply.code(req.params.id === "coo" ? 400 : 404);
      return { error: req.params.id === "coo" ? "the COO cannot be deleted" : "not found" };
    }
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/memories", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.memory.list(100);
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/skills", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.skills.list();
  });

  app.post<{
    Params: { id: string };
    Body: { raw?: string; name?: string; description?: string; body?: string; tags?: string[] };
  }>("/api/agents/:id/skills", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const b = req.body ?? {};
    try {
      if (b.raw) {
        const { meta, body } = ctx.skills.parseSkillFile(b.raw);
        if (!meta.name || !body) {
          reply.code(400);
          return { error: "skill markdown needs frontmatter `name` and a body" };
        }
        return ctx.skills.create({ meta, body, source: "imported" });
      }
      if (b.name && b.body) {
        return ctx.skills.create({
          meta: {
            name: b.name,
            description: b.description ?? "",
            version: "1.0.0",
            author: ctx.profile.id,
            tools: [],
            capabilities: [],
            parameters: {},
            tags: b.tags ?? [],
          },
          body: b.body,
          source: "authored",
        });
      }
      reply.code(400);
      return { error: "provide `raw` markdown, or `name` + `body`" };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.delete<{ Params: { id: string; skillId: string } }>(
    "/api/agents/:id/skills/:skillId",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok: ctx.skills.delete(req.params.skillId) };
    }
  );

  app.delete<{ Params: { id: string; memId: string } }>(
    "/api/agents/:id/memories/:memId",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      ctx.memory.delete(req.params.memId);
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/agents/:id/credentials",
    async (req, reply) => {
      const ok = orch.setCredentials(req.params.id, req.body ?? {});
      if (!ok) {
        reply.code(404);
        return { error: "not found" };
      }
      return { ok: true };
    }
  );

  // --- Agent-to-agent bus + subagent tasks ---
  app.get<{ Querystring: { limit?: string } }>("/api/bus/messages", async (req) =>
    orch.getBus().history(Number(req.query.limit ?? 200))
  );
  app.get("/api/subagent-tasks", async () => orch.listSubagentTasks());

  // --- Scheduled tasks ---
  app.get<{ Params: { id: string } }>("/api/agents/:id/scheduled-tasks", async (req) =>
    orch.getScheduler().list(req.params.id)
  );

  app.post<{ Params: { id: string }; Body: { cron: string; prompt: string } }>(
    "/api/agents/:id/scheduled-tasks",
    async (req, reply) => {
      const { cron, prompt } = req.body ?? {};
      if (!cron || !prompt) {
        reply.code(400);
        return { error: "cron and prompt are required" };
      }
      const task = orch.getScheduler().add(req.params.id, cron, prompt);
      if (!task) {
        reply.code(400);
        return { error: "invalid cron expression" };
      }
      return task;
    }
  );

  app.delete<{ Params: { taskId: string } }>("/api/scheduled-tasks/:taskId", async (req, reply) => {
    const ok = orch.getScheduler().cancel(req.params.taskId);
    if (!ok) {
      reply.code(404);
      return { error: "not found" };
    }
    return { ok: true };
  });

  // --- Skills (COO-scoped legacy surface) ---
  app.get("/api/skills", async () => getSkillService().list());

  app.post<{ Body: { url?: string; raw?: string } }>("/api/skills/import", async (req, reply) => {
    const { url, raw } = req.body;
    try {
      if (url) return await importSkillFromUrl(url);
      if (raw) return importSkillFromRaw(raw);
      reply.code(400);
      return { error: "Provide `url` or `raw`" };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.get("/api/skills/export-all", async () => exportAllSkills());

  app.get<{ Params: { id: string } }>("/api/skills/:id/export", async (req, reply) => {
    const md = getSkillService().exportAsMarkdown(req.params.id);
    if (!md) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.header("content-type", "text/markdown");
    return md;
  });

  // --- Memory + Profile (COO-scoped legacy surface) ---
  app.get("/api/memories", async () => getMemoryService().list(100));
  app.get("/api/user-profile", async () => getUserProfileService().get());

  // --- Desktop ---
  registerDesktopProxy(app);

  return app;
}
