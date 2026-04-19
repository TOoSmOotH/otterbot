import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { getDb } from "./db/index.js";
import { attachSocketServer } from "./socket.js";
import { registerDesktopProxy } from "./desktop/desktop.js";
import { getSkillService } from "./skills/skill-service.js";
import { getMemoryService } from "./memory/memory-service.js";
import { getUserProfileService } from "./user-profile/user-profile-service.js";
import { discoverModelPacks } from "./views/model-packs.js";
import { discoverSceneConfigs } from "./views/scene-configs.js";
import { discoverEnvironmentPacks } from "./views/environment-packs.js";
import { importSkillFromRaw, importSkillFromUrl, exportAllSkills } from "./skills/skill-hub.js";

async function main() {
  const cfg = getConfig();
  const app = Fastify({ logger: { level: cfg.logLevel } });

  await app.register(fastifyCors, { origin: true, credentials: true });

  // Initialize DB & load skills from disk into DB
  getDb();
  const loaded = getSkillService().loadFromDisk();
  app.log.info({ loaded }, "skills loaded from disk");

  // Static assets (3D models, textures) under /assets/3d/*
  await app.register(fastifyStatic, {
    root: cfg.assetsDir,
    prefix: "/assets/3d/",
    decorateReply: false,
  });

  // Serve noVNC bundle (if desktop enabled, web lazy-loads /novnc/core/rfb.js)
  const novncDir = resolve(process.cwd(), "node_modules/@novnc/novnc");
  try {
    await app.register(fastifyStatic, {
      root: novncDir,
      prefix: "/novnc/",
      decorateReply: false,
    });
  } catch {
    app.log.warn("noVNC not installed — desktop view will not load rfb.js");
  }

  // --- Views (model packs / scenes / environment packs) ---
  app.get("/api/model-packs", async () => discoverModelPacks(cfg.assetsDir));
  app.get("/api/scenes", async () => discoverSceneConfigs(cfg.assetsDir));
  app.get("/api/environment-packs", async () => discoverEnvironmentPacks(cfg.assetsDir));

  // --- Skills ---
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

  // --- Memory + Profile (read-only surface for web display) ---
  app.get("/api/memories", async () => getMemoryService().list(100));
  app.get("/api/user-profile", async () => getUserProfileService().get());

  // --- Desktop ---
  registerDesktopProxy(app);

  // --- Start ---
  await app.ready();
  const io = attachSocketServer(app.server);
  void io;

  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`otterbot v2 listening on http://${cfg.host}:${cfg.port}`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
