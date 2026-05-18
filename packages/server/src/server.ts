import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import { resolve, extname } from "node:path";
import { existsSync, createReadStream } from "node:fs";
import type { Config } from "./config.js";
import type { Orchestrator, CreateAgentInput } from "./orchestrator/orchestrator.js";
import { PROVIDERS } from "./providers/types.js";
import { getSkillService } from "./skills/skill-service.js";
import { getMemoryService } from "./memory/memory-service.js";
import { getUserProfileService } from "./user-profile/user-profile-service.js";
import { importSkillFromRaw, importSkillFromUrl, exportAllSkills } from "./skills/skill-hub.js";
import { formatScanFindings, scanSkillContent } from "./skills/skill-scanner.js";
import { initOpenAiAuth, getOpenAiAuth } from "./auth/openai-auth-store.js";
import { builtinModelStatus, downloadBuiltinModel } from "./embedders/builtin-embedder.js";
import { SKILL_CATALOG, getCatalogSkill, catalogSkillUrl } from "./skills/builtin-catalog.js";
import { generateText } from "ai";
import { resolveChatModel, listProviderModels } from "./providers/registry.js";
import type { AgentProfile, ProviderId, MemoryCategory, GlobalSettings } from "@otterbot/shared";
import { redactGlobalSettings } from "./orchestrator/orchestrator.js";

/**
 * Build the Fastify HTTP API over a booted `Orchestrator`. Does not call
 * `listen()` — `index.ts` does that for the real process, while tests use
 * `app.inject()`.
 */
export async function buildServer(orch: Orchestrator, cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: cfg.logLevel } });

  await app.register(fastifyCors, { origin: true, credentials: true });
  // Avatar uploads — capped well above any reasonable image.
  await app.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1 } });

  // Instance-wide ChatGPT OAuth store, backed by control.db app_settings. The
  // real process initialises this before `orch.boot()` so agent runtimes and
  // API routes share the same token owner; this fallback covers tests/tools
  // that build the server around an already-booted orchestrator.
  if (!getOpenAiAuth()) {
    initOpenAiAuth({
      getSetting: (k) => orch.getSetting(k),
      setSetting: (k, v) => orch.setSetting(k, v),
    });
  }

  // --- Providers (for the model picker) ---
  app.get("/api/providers", async () => PROVIDERS);

  app.get("/api/settings/global", async () => redactGlobalSettings(orch.getGlobalSettings()));

  app.put<{ Body: GlobalSettings }>("/api/settings/global", async (req, reply) => {
    if (!req.body?.defaultChatModel || !req.body.defaultEmbeddingModel || !req.body.providers) {
      reply.code(400);
      return { error: "theme, default models, and providers are required" };
    }
    return redactGlobalSettings(orch.setGlobalSettings(req.body));
  });

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
      const mergedSecrets = new Map([
        ...orch.getGlobalProviderSecrets(),
        ...Object.entries(secrets ?? {}),
      ]);
      const model = resolveChatModel(
        { provider, modelId },
        mergedSecrets
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

  // List the models a provider currently serves (for the model picker).
  app.post<{
    Body: { provider?: ProviderId; secrets?: Record<string, string> };
  }>("/api/provider-models", async (req, reply) => {
    const { provider, secrets } = req.body ?? {};
    if (!provider) {
      reply.code(400);
      return { ok: false, error: "provider is required" };
    }
    try {
      const mergedSecrets = new Map([
        ...orch.getGlobalProviderSecrets(),
        ...Object.entries(secrets ?? {}),
      ]);
      const models = await listProviderModels(provider, mergedSecrets);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // --- ChatGPT subscription (OpenAI OAuth) ---
  app.get("/api/auth/openai/status", async () => {
    return getOpenAiAuth()?.status() ?? { connected: false, accountId: null, expiresAt: null };
  });

  // Start the browser login flow; returns the URL for the client to open.
  app.post("/api/auth/openai/login", async (_req, reply) => {
    const auth = getOpenAiAuth();
    if (!auth) {
      reply.code(500);
      return { error: "auth store not initialised" };
    }
    try {
      return auth.beginLogin();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Complete a login by pasting the redirect URL — for when the loopback
  // callback is unreachable from the browser (otterbot on a remote box).
  app.post<{ Body: { url?: string } }>("/api/auth/openai/complete", async (req, reply) => {
    const auth = getOpenAiAuth();
    if (!auth) {
      reply.code(500);
      return { ok: false, error: "auth store not initialised" };
    }
    try {
      await auth.completeManual(req.body?.url ?? "");
      return { ok: true, status: auth.status() };
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post("/api/auth/openai/signout", async () => {
    getOpenAiAuth()?.signOut();
    return { ok: true };
  });

  // --- Built-in embedder model ---
  // The in-process CPU embedder's model is downloaded only on explicit
  // request — never bundled, never auto-downloaded.
  app.get("/api/embedder/builtin/status", async () => builtinModelStatus());

  app.post("/api/embedder/builtin/download", async () => {
    // Runs in the background; the client polls the status endpoint.
    void downloadBuiltinModel();
    return builtinModelStatus();
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
    const ok = await orch.deleteAgent(req.params.id);
    if (!ok) {
      reply.code(req.params.id === "coo" ? 400 : 404);
      return { error: req.params.id === "coo" ? "the COO cannot be deleted" : "not found" };
    }
    return { ok: true };
  });

  // --- Agent avatars ---
  const AVATAR_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const AVATAR_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  app.post<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    let file;
    try {
      file = await req.file();
    } catch {
      reply.code(400);
      return { error: "expected a multipart image upload" };
    }
    if (!file) {
      reply.code(400);
      return { error: "no image uploaded" };
    }
    const ext = AVATAR_EXT[file.mimetype];
    if (!ext) {
      reply.code(400);
      return { error: "unsupported image type — use PNG, JPG, WebP or GIF" };
    }
    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch {
      reply.code(413);
      return { error: "image is too large (max 4 MB)" };
    }
    const updated = orch.setAgentAvatar(req.params.id, data, ext);
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return updated;
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    const file = orch.agentAvatarPath(req.params.id);
    if (!file) {
      reply.code(404);
      return { error: "no avatar" };
    }
    reply.header("content-type", AVATAR_MIME[extname(file).toLowerCase()] ?? "application/octet-stream");
    reply.header("cache-control", "no-cache");
    return reply.send(createReadStream(file));
  });

  app.delete<{ Params: { id: string } }>("/api/agents/:id/avatar", async (req, reply) => {
    const updated = orch.clearAgentAvatar(req.params.id);
    if (!updated) {
      reply.code(404);
      return { error: "not found" };
    }
    return updated;
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id/memories", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    return ctx.memory.list(100);
  });

  // Manually add a memory to an agent (the user curating the agent's memory).
  app.post<{
    Params: { id: string };
    Body: { content?: string; category?: MemoryCategory; importance?: number };
  }>("/api/agents/:id/memories", async (req, reply) => {
    const ctx = orch.getContext(req.params.id);
    if (!ctx) {
      reply.code(404);
      return { error: "not found" };
    }
    const content = (req.body?.content ?? "").trim();
    if (!content) {
      reply.code(400);
      return { error: "content is required" };
    }
    return ctx.memory.save({
      content,
      category: req.body?.category ?? "fact",
      importance: req.body?.importance ?? 7,
      source: "user",
    });
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

  // The Hermes skill catalog (built-in + optional) — index only; bodies fetched on install.
  app.get("/api/skill-catalog", async () => SKILL_CATALOG);

  // Install a catalog skill onto an agent: fetch its SKILL.md, scan it, store it.
  app.post<{ Params: { id: string }; Body: { catalogId?: string } }>(
    "/api/agents/:id/skills/install",
    async (req, reply) => {
      const ctx = orch.getContext(req.params.id);
      if (!ctx) {
        reply.code(404);
        return { error: "not found" };
      }
      const entry = getCatalogSkill(req.body?.catalogId ?? "");
      if (!entry) {
        reply.code(400);
        return { error: "unknown catalog skill" };
      }
      try {
        const res = await fetch(catalogSkillUrl(entry), { redirect: "follow" });
        if (!res.ok) {
          reply.code(502);
          return { error: `could not fetch skill from GitHub: ${res.status} ${res.statusText}` };
        }
        const raw = await res.text();
        const scan = scanSkillContent(raw);
        if (scan.findings.some((f) => f.severity === "error")) {
          reply.code(400);
          return {
            error: "skill rejected by security scanner: " +
              formatScanFindings(scan.findings),
          };
        }
        const { meta, body } = ctx.skills.parseSkillFile(raw);
        if (!meta.name || !body) {
          reply.code(400);
          return { error: "the fetched SKILL.md is missing frontmatter `name` or a body" };
        }
        return ctx.skills.create({ meta, body, source: "builtin" }, { scanReport: scan });
      } catch (err) {
        reply.code(502);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

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

  // --- Built web app (single-port production) ---
  if (existsSync(resolve(cfg.webDistDir, "index.html"))) {
    await app.register(fastifyStatic, {
      root: cfg.webDistDir,
      prefix: "/",
      decorateReply: true,
      wildcard: false,
    });

    app.setNotFoundHandler((req, reply) => {
      if (shouldServeWebApp(req.method, req.url)) {
        return reply.sendFile("index.html");
      }
      reply.code(404);
      return { error: "not found" };
    });
  } else {
    app.log.info(
      `web build not found (${cfg.webDistDir}); serving API only. Run pnpm --filter @otterbot/web build for single-port mode.`
    );
  }

  return app;
}

function shouldServeWebApp(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = url.split("?")[0] || "/";
  if (
    path.startsWith("/api/") ||
    path === "/api" ||
    path.startsWith("/socket.io/") ||
    path === "/socket.io"
  ) {
    return false;
  }
  return !path.split("/").pop()?.includes(".");
}
