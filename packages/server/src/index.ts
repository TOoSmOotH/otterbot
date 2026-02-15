import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { resolve, dirname, join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  RegistryEntryCreate,
  RegistryEntryUpdate,
  SceneConfig,
} from "@smoothbot/shared";
import { migrateDb } from "./db/index.js";
import { MessageBus } from "./bus/message-bus.js";
import { WorkspaceManager } from "./workspace/workspace.js";
import { Registry } from "./registry/registry.js";
import { COO } from "./agents/coo.js";
import { closeBrowser } from "./tools/browser-pool.js";
import { getConfiguredTTSProvider } from "./tts/tts.js";
import { getConfiguredSTTProvider } from "./stt/stt.js";
import {
  setupSocketHandlers,
  emitAgentSpawned,
  emitAgentStatus,
  emitCooStream,
  emitCooThinking,
  emitCooThinkingEnd,
  emitProjectCreated,
  emitProjectUpdated,
  emitProjectDeleted,
  emitKanbanTaskCreated,
  emitKanbanTaskUpdated,
  emitKanbanTaskDeleted,
  emitAgentStream,
  emitAgentThinking,
  emitAgentThinkingEnd,
  emitAgentToolCall,
} from "./socket/handlers.js";
import {
  isSetupComplete,
  hashPassphrase,
  verifyPassphrase,
  getConfig,
  setConfig,
  deleteConfig,
  createSession,
  validateSession,
  destroySession,
} from "./auth/auth.js";
import { discoverModelPacks } from "./models3d/model-packs.js";
import { discoverEnvironmentPacks } from "./models3d/environment-packs.js";
import { discoverSceneConfigs } from "./models3d/scene-configs.js";
import { registerDesktopProxy, isDesktopEnabled, getDesktopConfig } from "./desktop/desktop.js";
import {
  listPackages,
  installAptPackage,
  uninstallAptPackage,
  installNpmPackage,
  uninstallNpmPackage,
  installRepo,
  uninstallRepo,
} from "./packages/packages.js";
import {
  getSettings,
  listProviders,
  createProvider,
  updateProvider as updateProviderRow,
  deleteProvider,
  getProviderRow,
  updateTierDefaults,
  testProvider,
  fetchModels,
  fetchModelsWithCredentials,
  PROVIDER_TYPE_META,
  getSearchSettings,
  updateSearchProviderConfig,
  setActiveSearchProvider,
  testSearchProvider,
  getTTSSettings,
  updateTTSProviderConfig,
  setActiveTTSProvider,
  setTTSEnabled,
  setTTSVoice,
  setTTSSpeed,
  testTTSProvider,
  getSTTSettings,
  setSTTEnabled,
  setActiveSTTProvider,
  setSTTLanguage,
  setSTTModel,
  updateSTTProviderConfig,
  testSTTProvider,
  getOpenCodeSettings,
  updateOpenCodeSettings,
  testOpenCodeConnection,
  listCustomModels,
  createCustomModel,
  deleteCustomModel,
  type TierDefaults,
} from "./settings/settings.js";
import type { ProviderType } from "@smoothbot/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Public API path whitelist (no auth required)
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = ["/api/setup/", "/api/auth/", "/api/model-packs", "/api/environment-packs", "/api/scenes"];

// ---------------------------------------------------------------------------
// Cookie helper for Socket.IO (parse raw Cookie header)
// ---------------------------------------------------------------------------

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );
}

// ---------------------------------------------------------------------------
// Self-signed TLS certificate for HTTPS
// ---------------------------------------------------------------------------

function ensureSelfSignedCert(dataDir: string): { key: Buffer; cert: Buffer } {
  const certDir = join(dataDir, "certs");
  const keyPath = join(certDir, "selfsigned.key");
  const certPath = join(certDir, "selfsigned.crt");

  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(certDir, { recursive: true });
    console.log("Generating self-signed TLS certificate...");
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} ` +
        `-days 365 -nodes -subj "/CN=smoothbot"`,
      { stdio: "pipe" },
    );
  }

  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  };
}

async function main() {
  // Initialize database
  await migrateDb();

  // Mark stale agents from previous runs as "done"
  {
    const { getDb, schema } = await import("./db/index.js");
    const { ne } = await import("drizzle-orm");
    const db = getDb();
    db.update(schema.agents)
      .set({ status: "done" })
      .where(ne(schema.agents.status, "done"))
      .run();
  }
  console.log("Database initialized.");

  // Core services
  const bus = new MessageBus();
  const workspace = new WorkspaceManager();
  const registry = new Registry();

  // Create Fastify server with HTTPS (required for mic/getUserMedia from remote hosts)
  const dataDir = process.env.WORKSPACE_ROOT ?? resolve(__dirname, "../../../docker/smoothbot");
  const tls = ensureSelfSignedCert(join(dataDir, "data"));
  const app = Fastify({ logger: false, https: { key: tls.key, cert: tls.cert } });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(fastifyCookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Serve static web build if it exists
  const webDistPath = resolve(__dirname, "../../web/dist");
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
    });
  }

  // Serve 3D assets (model packs)
  const assetsRoot = resolve(__dirname, "../../../assets");
  console.log(`3D assets root: ${assetsRoot} (exists: ${existsSync(assetsRoot)})`);
  if (existsSync(assetsRoot)) {
    await app.register(fastifyStatic, {
      root: assetsRoot,
      prefix: "/assets/3d/",
      decorateReply: false,
    });
  }

  // Serve noVNC ES module source (for the desktop VNC viewer)
  // In Docker: /app/novnc/ (downloaded from GitHub during build)
  // Locally: check both relative to dist/ and relative to project root
  const novncCandidates = [
    resolve(__dirname, "../../../novnc"),        // /app/novnc (Docker prod)
    resolve(__dirname, "../../../../novnc"),      // fallback
  ];
  const novncRoot = novncCandidates.find((p) => existsSync(p));
  console.log(`noVNC root: ${novncRoot ?? "NOT FOUND"} (candidates: ${novncCandidates.join(", ")})`);

  // Serve noVNC files with an explicit route handler to avoid fastify-static prefix conflicts.
  // Uses readFileSync instead of sendFile to avoid dependency on fastify-static decoration.
  app.get("/novnc/*", async (req, reply) => {
    if (!novncRoot) {
      reply.code(404);
      return { error: "noVNC not installed" };
    }
    const filePath = (req.params as { "*": string })["*"];
    const fullPath = resolve(novncRoot, filePath);

    // Prevent directory traversal
    if (!fullPath.startsWith(novncRoot)) {
      reply.code(403);
      return { error: "Forbidden" };
    }

    if (!existsSync(fullPath)) {
      console.log(`[novnc] 404: ${filePath} (resolved: ${fullPath})`);
      reply.code(404);
      return { error: `noVNC file not found: ${filePath}` };
    }

    // Set correct MIME type for ES modules
    if (filePath.endsWith(".js")) {
      reply.type("application/javascript; charset=utf-8");
    } else if (filePath.endsWith(".json")) {
      reply.type("application/json; charset=utf-8");
    }

    const content = readFileSync(fullPath);
    return reply.send(content);
  });

  // Create Socket.IO server
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    app.server,
    {
      cors: { origin: true, credentials: true },
    },
  );

  // Register VNC WebSocket proxy (must be before Socket.IO starts listening)
  registerDesktopProxy(app);

  // =========================================================================
  // Socket.IO auth middleware
  // =========================================================================

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies.sb_session;
    if (!validateSession(token)) {
      return next(new Error("Authentication required"));
    }
    next();
  });

  // =========================================================================
  // Deferred COO startup
  // =========================================================================

  let coo: COO | null = null;

  function startCoo() {
    if (coo) return;
    try {
      const cooRegistryId = getConfig("coo_registry_id");
      console.log(`Starting COO... (coo_registry_id=${cooRegistryId ?? "none"}, coo_model=${getConfig("coo_model") ?? "default"}, coo_provider=${getConfig("coo_provider") ?? "default"})`);
      coo = new COO({
        bus,
        workspace,
        onAgentSpawned: (agent) => {
          emitAgentSpawned(io, agent);
        },
        onStatusChange: (agentId, status) => {
          emitAgentStatus(io, agentId, status);
        },
        onStream: (token, messageId) => {
          emitCooStream(io, token, messageId);
        },
        onThinking: (token, messageId) => {
          emitCooThinking(io, token, messageId);
        },
        onThinkingEnd: (messageId) => {
          emitCooThinkingEnd(io, messageId);
        },
        onProjectCreated: (project) => {
          emitProjectCreated(io, project);
        },
        onProjectUpdated: (project) => {
          emitProjectUpdated(io, project);
        },
        onKanbanTaskCreated: (task) => {
          emitKanbanTaskCreated(io, task);
        },
        onKanbanTaskUpdated: (task) => {
          emitKanbanTaskUpdated(io, task);
        },
        onKanbanTaskDeleted: (taskId, projectId) => {
          emitKanbanTaskDeleted(io, taskId, projectId);
        },
        onAgentStream: (agentId, token, messageId) => {
          emitAgentStream(io, agentId, token, messageId);
        },
        onAgentThinking: (agentId, token, messageId) => {
          emitAgentThinking(io, agentId, token, messageId);
        },
        onAgentThinkingEnd: (agentId, messageId) => {
          emitAgentThinkingEnd(io, agentId, messageId);
        },
        onAgentToolCall: (agentId, toolName, args) => {
          emitAgentToolCall(io, agentId, toolName, args);
        },
      });
      emitAgentSpawned(io, coo);
      setupSocketHandlers(io, bus, coo, registry);
      console.log(`COO agent started. (model=${coo.toData().model}, provider=${coo.toData().provider})`);
    } catch (err) {
      console.error("Failed to start COO agent:", err);
    }
  }

  if (isSetupComplete()) {
    startCoo();
  } else {
    console.log("Setup not complete. Waiting for setup wizard...");
  }

  // =========================================================================
  // Public routes (no auth required)
  // =========================================================================

  // --- Setup ---

  app.get("/api/setup/status", async () => {
    return {
      setupComplete: isSetupComplete(),
      providerTypes: PROVIDER_TYPE_META,
    };
  });

  app.post<{
    Body: { provider: string; apiKey?: string; baseUrl?: string };
  }>("/api/setup/probe-models", async (req, reply) => {
    const { provider, apiKey, baseUrl } = req.body;
    if (!provider) {
      reply.code(400);
      return { error: "provider is required" };
    }
    const models = await fetchModelsWithCredentials(provider, apiKey, baseUrl);
    return { models };
  });

  app.post<{
    Body: { voice: string; provider?: string };
  }>("/api/setup/tts-preview", async (req, reply) => {
    const { voice, provider: ttsProvider } = req.body;
    if (!voice) {
      reply.code(400);
      return { error: "voice is required" };
    }

    // Temporarily configure the requested provider (default kokoro for backwards compat)
    const previousActive = getConfig("tts:active_provider");
    setConfig("tts:active_provider", ttsProvider || "kokoro");

    try {
      const provider = getConfiguredTTSProvider();
      if (!provider) {
        reply.code(500);
        return { error: "TTS provider unavailable" };
      }

      const { audio, contentType } = await provider.synthesize(
        "Hello from your AI assistant.",
        voice,
        1,
      );

      reply.header("Content-Type", contentType);
      return reply.send(audio);
    } catch (err) {
      reply.code(500);
      return {
        error: err instanceof Error ? err.message : "TTS synthesis failed",
      };
    } finally {
      if (previousActive) {
        setConfig("tts:active_provider", previousActive);
      } else {
        deleteConfig("tts:active_provider");
      }
    }
  });

  // --- Model Packs (public for setup wizard) ---

  app.get("/api/model-packs", async () => {
    const packs = discoverModelPacks(assetsRoot);
    console.log(`GET /api/model-packs → ${packs.length} packs found`);
    return packs;
  });

  app.get("/api/environment-packs", async () => {
    const packs = discoverEnvironmentPacks(assetsRoot);
    console.log(`GET /api/environment-packs → ${packs.length} packs found`);
    return packs;
  });

  app.get("/api/scenes", async () => {
    const configs = discoverSceneConfigs(assetsRoot);
    console.log(`GET /api/scenes → ${configs.length} scenes found`);
    return configs;
  });

  app.post<{
    Body: {
      passphrase: string;
      provider: string;
      providerName?: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
      userName: string;
      userAvatar?: string;
      userBio?: string;
      userTimezone: string;
      ttsVoice?: string;
      ttsProvider?: string;
      userModelPackId?: string;
      userGearConfig?: Record<string, boolean> | null;
      cooName: string;
      cooModelPackId?: string;
      cooGearConfig?: Record<string, boolean> | null;
      searchProvider?: string;
      searchApiKey?: string;
      searchBaseUrl?: string;
    };
  }>("/api/setup/complete", async (req, reply) => {
    if (isSetupComplete()) {
      reply.code(400);
      return { error: "Setup already completed" };
    }

    const { passphrase, provider, providerName, model, apiKey, baseUrl, userName, userAvatar, userBio, userTimezone, ttsVoice, ttsProvider, userModelPackId, userGearConfig, cooName, cooModelPackId, cooGearConfig, searchProvider, searchApiKey, searchBaseUrl } = req.body;

    if (!passphrase || passphrase.length < 8) {
      reply.code(400);
      return { error: "Passphrase must be at least 8 characters" };
    }
    if (!provider || !model) {
      reply.code(400);
      return { error: "Provider and model are required" };
    }
    if (!userName || !userName.trim()) {
      reply.code(400);
      return { error: "Display name is required" };
    }
    if (!userTimezone) {
      reply.code(400);
      return { error: "Timezone is required" };
    }
    if (!cooName || !cooName.trim()) {
      reply.code(400);
      return { error: "COO name is required" };
    }

    // Store config
    const hash = await hashPassphrase(passphrase);
    setConfig("passphrase_hash", hash);

    // Create a named provider row
    const typeMeta = PROVIDER_TYPE_META.find((m) => m.type === provider);
    const namedProvider = createProvider({
      name: providerName || typeMeta?.label || provider,
      type: provider as ProviderType,
      apiKey: apiKey,
      baseUrl: baseUrl,
    });

    setConfig("coo_provider", namedProvider.id);
    setConfig("coo_model", model);

    // Store user profile
    setConfig("user_name", userName.trim());
    setConfig("user_timezone", userTimezone);
    if (userAvatar) {
      setConfig("user_avatar", userAvatar);
    }
    if (userBio) {
      setConfig("user_bio", userBio.trim());
    }

    // Store TTS preference
    if (ttsVoice) {
      setConfig("tts:enabled", "true");
      setConfig("tts:active_provider", ttsProvider || "kokoro");
      setConfig("tts:voice", ttsVoice);
    }

    // Store search provider preference
    if (searchProvider) {
      setConfig("search:active_provider", searchProvider);
      if (searchApiKey) setConfig(`search:${searchProvider}:api_key`, searchApiKey);
      if (searchBaseUrl) setConfig(`search:${searchProvider}:base_url`, searchBaseUrl);
    }

    // Store 3D model pack preference
    if (userModelPackId) {
      setConfig("user_model_pack_id", userModelPackId);
    }

    // Store gear config
    if (userGearConfig) {
      setConfig("user_gear_config", JSON.stringify(userGearConfig));
    }

    // Clone the built-in COO template with the user's customizations
    const cooSource = registry.get("builtin-coo");
    if (cooSource) {
      const cooClone = registry.create({
        name: cooName.trim(),
        description: cooSource.description,
        systemPrompt: cooSource.systemPrompt,
        promptAddendum: null,
        capabilities: [...cooSource.capabilities],
        defaultModel: model,
        defaultProvider: namedProvider.id,
        tools: [...cooSource.tools],
        role: cooSource.role,
        clonedFromId: "builtin-coo",
        modelPackId: cooModelPackId ?? null,
        gearConfig: cooGearConfig ?? null,
      });
      setConfig("coo_registry_id", cooClone.id);
    }

    // Create session
    const { token, maxAge } = createSession();
    reply.setCookie("sb_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge,
    });

    // Start the COO agent now that config is in place
    startCoo();

    return { ok: true };
  });

  // --- Auth ---

  app.post<{ Body: { passphrase: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      if (!isSetupComplete()) {
        reply.code(400);
        return { error: "Setup not complete" };
      }

      const storedHash = getConfig("passphrase_hash");
      if (!storedHash) {
        reply.code(500);
        return { error: "No passphrase configured" };
      }

      const valid = await verifyPassphrase(req.body.passphrase, storedHash);
      if (!valid) {
        reply.code(401);
        return { error: "Invalid passphrase" };
      }

      const { token, maxAge } = createSession();
      reply.setCookie("sb_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge,
      });

      return { ok: true };
    },
  );

  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies.sb_session;
    if (token) {
      destroySession(token);
    }
    reply.clearCookie("sb_session", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/check", async (req) => {
    const token = req.cookies.sb_session;
    return { authenticated: validateSession(token) };
  });

  // =========================================================================
  // Auth middleware — protects all /api/* routes registered after this hook
  // =========================================================================

  app.addHook("onRequest", async (req, reply) => {
    // Skip non-API routes (static files, SPA)
    if (!req.url.startsWith("/api/")) return;

    // Skip public API routes
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    const token = req.cookies.sb_session;
    if (!validateSession(token)) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // =========================================================================
  // Protected routes
  // =========================================================================

  // Desktop status
  app.get("/api/desktop/status", async () => ({
    enabled: isDesktopEnabled(),
    resolution: getDesktopConfig().resolution,
    wsPath: "/desktop/ws",
  }));

  // REST API for registry
  app.get("/api/registry", async () => {
    return registry.list();
  });

  app.get<{ Params: { id: string } }>(
    "/api/registry/:id",
    async (req, reply) => {
      const entry = registry.get(req.params.id);
      if (!entry) {
        reply.code(404);
        return { error: "Not found" };
      }
      return entry;
    },
  );

  app.post<{ Body: RegistryEntryCreate }>(
    "/api/registry",
    async (req) => {
      return registry.create(req.body);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/registry/:id/clone",
    async (req, reply) => {
      const cloned = registry.clone(req.params.id);
      if (!cloned) {
        reply.code(404);
        return { error: "Not found" };
      }
      return cloned;
    },
  );

  app.patch<{ Params: { id: string }; Body: RegistryEntryUpdate }>(
    "/api/registry/:id",
    async (req, reply) => {
      const existing = registry.get(req.params.id);
      if (!existing) {
        reply.code(404);
        return { error: "Not found" };
      }
      if (existing.builtIn) {
        reply.code(403);
        return { error: "Built-in templates cannot be modified. Clone it first." };
      }
      const entry = registry.update(req.params.id, req.body);
      return entry;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/registry/:id",
    async (req, reply) => {
      const existing = registry.get(req.params.id);
      if (!existing) {
        reply.code(404);
        return { error: "Not found" };
      }
      if (existing.builtIn) {
        reply.code(403);
        return { error: "Built-in templates cannot be deleted" };
      }
      const cooRegistryId = getConfig("coo_registry_id");
      if (cooRegistryId && req.params.id === cooRegistryId) {
        reply.code(403);
        return { error: "The COO template cannot be deleted. Edit it instead." };
      }
      registry.delete(req.params.id);
      return { ok: true };
    },
  );

  // Message history endpoint (cursor-paginated)
  app.get<{
    Querystring: { projectId?: string; agentId?: string; limit?: string; before?: string };
  }>("/api/messages", async (req) => {
    return bus.getHistory({
      projectId: req.query.projectId,
      agentId: req.query.agentId,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
      before: req.query.before,
    });
  });

  // Conversations endpoint
  app.get("/api/conversations", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const { desc } = await import("drizzle-orm");
    const db = getDb();
    return db
      .select()
      .from(schema.conversations)
      .orderBy(desc(schema.conversations.updatedAt))
      .all();
  });

  // =========================================================================
  // Project routes
  // =========================================================================

  app.get("/api/projects", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const { desc } = await import("drizzle-orm");
    const db = getDb();
    return db
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.createdAt))
      .all();
  });

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (req, reply) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, req.params.projectId))
        .get();
      if (!project) {
        reply.code(404);
        return { error: "Project not found" };
      }
      return project;
    },
  );

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/conversations",
    async (req) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq, desc } = await import("drizzle-orm");
      const db = getDb();
      return db
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.projectId, req.params.projectId))
        .orderBy(desc(schema.conversations.updatedAt))
        .all();
    },
  );

  app.delete<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (req, reply) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, req.params.projectId))
        .get();
      if (!project) {
        reply.code(404);
        return { error: "Project not found" };
      }

      // Stop running agents and remove workspace
      if (coo) {
        coo.destroyProject(req.params.projectId);
      }

      // Cascade-delete related DB records
      db.delete(schema.kanbanTasks).where(eq(schema.kanbanTasks.projectId, req.params.projectId)).run();
      db.delete(schema.agentActivity).where(eq(schema.agentActivity.projectId, req.params.projectId)).run();
      db.delete(schema.messages).where(eq(schema.messages.projectId, req.params.projectId)).run();
      db.delete(schema.conversations).where(eq(schema.conversations.projectId, req.params.projectId)).run();
      db.delete(schema.agents).where(eq(schema.agents.projectId, req.params.projectId)).run();
      db.delete(schema.projects).where(eq(schema.projects.id, req.params.projectId)).run();

      // Broadcast deletion via socket
      emitProjectDeleted(io, req.params.projectId);

      return { ok: true };
    },
  );

  // =========================================================================
  // Project file browser routes
  // =========================================================================

  app.get<{ Params: { projectId: string }; Querystring: { path?: string } }>(
    "/api/projects/:projectId/files",
    async (req, reply) => {
      const { readdirSync, statSync } = await import("node:fs");
      const { resolve: resolvePath, normalize, join } = await import("node:path");
      const projectRoot = workspace.projectPath(req.params.projectId);
      if (!existsSync(projectRoot)) {
        reply.code(404);
        return { error: "Project not found" };
      }
      const relPath = req.query.path || "";
      const target = normalize(resolvePath(projectRoot, relPath));
      if (!target.startsWith(projectRoot)) {
        reply.code(403);
        return { error: "Access denied" };
      }
      if (!existsSync(target)) {
        reply.code(404);
        return { error: "Path not found" };
      }
      const raw = readdirSync(target, { withFileTypes: true });
      const entries = raw
        .filter((d) => !d.name.startsWith("."))
        .map((d) => {
          const fullPath = join(target, d.name);
          try {
            const st = statSync(fullPath);
            return {
              name: d.name,
              type: d.isDirectory() ? ("directory" as const) : ("file" as const),
              size: st.size,
              mtime: st.mtime.toISOString(),
            };
          } catch {
            return {
              name: d.name,
              type: d.isDirectory() ? ("directory" as const) : ("file" as const),
              size: 0,
              mtime: new Date().toISOString(),
            };
          }
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { path: relPath || "/", entries };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/api/projects/:projectId/files/content",
    async (req, reply) => {
      const { readFileSync } = await import("node:fs");
      const { resolve: resolvePath, normalize } = await import("node:path");
      const projectRoot = workspace.projectPath(req.params.projectId);
      const relPath = req.query.path;
      if (!relPath) {
        reply.code(400);
        return { error: "path query parameter required" };
      }
      const target = normalize(resolvePath(projectRoot, relPath));
      if (!target.startsWith(projectRoot)) {
        reply.code(403);
        return { error: "Access denied" };
      }
      if (!existsSync(target)) {
        reply.code(404);
        return { error: "File not found" };
      }
      const { statSync } = await import("node:fs");
      const st = statSync(target);
      const MAX_PREVIEW = 512 * 1024;
      const truncated = st.size > MAX_PREVIEW;
      const content = readFileSync(target, "utf-8").slice(0, MAX_PREVIEW);
      return { content, truncated, size: st.size };
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path: string } }>(
    "/api/projects/:projectId/files/download",
    async (req, reply) => {
      const { createReadStream } = await import("node:fs");
      const { resolve: resolvePath, normalize, basename, extname } = await import("node:path");
      const projectRoot = workspace.projectPath(req.params.projectId);
      const relPath = req.query.path;
      if (!relPath) {
        reply.code(400);
        return { error: "path query parameter required" };
      }
      const target = normalize(resolvePath(projectRoot, relPath));
      if (!target.startsWith(projectRoot)) {
        reply.code(403);
        return { error: "Access denied" };
      }
      if (!existsSync(target)) {
        reply.code(404);
        return { error: "File not found" };
      }
      const mimeMap: Record<string, string> = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".json": "application/json",
        ".js": "text/javascript",
        ".ts": "text/typescript",
        ".html": "text/html",
        ".css": "text/css",
        ".py": "text/x-python",
        ".sh": "text/x-shellscript",
        ".yaml": "text/yaml",
        ".yml": "text/yaml",
        ".xml": "text/xml",
        ".csv": "text/csv",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".zip": "application/zip",
      };
      const ext = extname(target).toLowerCase();
      const contentType = mimeMap[ext] ?? "application/octet-stream";
      const fileName = basename(target);
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      reply.header("Content-Type", contentType);
      return reply.send(createReadStream(target));
    },
  );

  // =========================================================================
  // Kanban task routes
  // =========================================================================

  app.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/tasks",
    async (req) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      return db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, req.params.projectId))
        .all();
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { title: string; description?: string; column?: string; labels?: string[]; blockedBy?: string[] };
  }>(
    "/api/projects/:projectId/tasks",
    async (req) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const { nanoid } = await import("nanoid");
      const db = getDb();
      const { title, description, column, labels, blockedBy } = req.body;
      const now = new Date().toISOString();

      // Get max position in column
      const existing = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.projectId, req.params.projectId))
        .all();
      const colTasks = existing.filter((t) => t.column === (column ?? "backlog"));
      const maxPos = colTasks.reduce((max, t) => Math.max(max, t.position), -1);

      const task = {
        id: nanoid(),
        projectId: req.params.projectId,
        title,
        description: description ?? "",
        column: (column ?? "backlog") as "backlog" | "in_progress" | "done",
        position: maxPos + 1,
        assigneeAgentId: null,
        createdBy: "user",
        labels: labels ?? [],
        blockedBy: blockedBy ?? [],
        createdAt: now,
        updatedAt: now,
      };
      db.insert(schema.kanbanTasks).values(task).run();

      // Broadcast via socket
      if (coo) {
        io.emit("kanban:task-created", task as any);
      }
      return task;
    },
  );

  app.patch<{
    Params: { projectId: string; taskId: string };
    Body: { title?: string; description?: string; column?: string; position?: number; assigneeAgentId?: string | null; labels?: string[]; blockedBy?: string[] };
  }>(
    "/api/projects/:projectId/tasks/:taskId",
    async (req, reply) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const existing = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, req.params.taskId))
        .get();
      if (!existing) {
        reply.code(404);
        return { error: "Task not found" };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.column !== undefined) updates.column = req.body.column;
      if (req.body.position !== undefined) updates.position = req.body.position;
      if (req.body.assigneeAgentId !== undefined) updates.assigneeAgentId = req.body.assigneeAgentId;
      if (req.body.labels !== undefined) updates.labels = req.body.labels;
      if (req.body.blockedBy !== undefined) updates.blockedBy = req.body.blockedBy;

      db.update(schema.kanbanTasks)
        .set(updates)
        .where(eq(schema.kanbanTasks.id, req.params.taskId))
        .run();

      const updated = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, req.params.taskId))
        .get();

      // Broadcast via socket
      if (updated) {
        io.emit("kanban:task-updated", updated as any);
      }
      return updated;
    },
  );

  app.delete<{ Params: { projectId: string; taskId: string } }>(
    "/api/projects/:projectId/tasks/:taskId",
    async (req, reply) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const existing = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, req.params.taskId))
        .get();
      if (!existing) {
        reply.code(404);
        return { error: "Task not found" };
      }

      db.delete(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, req.params.taskId))
        .run();

      // Broadcast via socket
      io.emit("kanban:task-deleted", {
        taskId: req.params.taskId,
        projectId: req.params.projectId,
      });
      return { ok: true };
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { column: string; taskIds: string[] };
  }>(
    "/api/projects/:projectId/tasks/reorder",
    async (req) => {
      const { getDb, schema } = await import("./db/index.js");
      const { eq } = await import("drizzle-orm");
      const db = getDb();
      const { column, taskIds } = req.body;
      for (let i = 0; i < taskIds.length; i++) {
        db.update(schema.kanbanTasks)
          .set({
            column: column as "backlog" | "in_progress" | "done",
            position: i,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.kanbanTasks.id, taskIds[i]))
          .run();
      }
      // Broadcast updates
      for (const taskId of taskIds) {
        const updated = db
          .select()
          .from(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.id, taskId))
          .get();
        if (updated) {
          io.emit("kanban:task-updated", updated as any);
        }
      }
      return { ok: true };
    },
  );

  // Package manifest endpoints
  app.get("/api/packages", async () => {
    return listPackages();
  });

  app.post<{
    Body: {
      type: "apt" | "npm" | "repo";
      name: string;
      version?: string;
      source?: string;
      keyUrl?: string;
      keyPath?: string;
    };
  }>("/api/packages", async (req, reply) => {
    const { type, name, version, source, keyUrl, keyPath } = req.body;
    if (!type || !name) {
      reply.code(400);
      return { error: "type and name are required" };
    }
    if (type === "apt") {
      const result = installAptPackage(name, "user");
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, installed: true, alreadyInManifest: result.alreadyInManifest };
    } else if (type === "npm") {
      const result = installNpmPackage(name, version, "user");
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, installed: true, alreadyInManifest: result.alreadyInManifest };
    } else if (type === "repo") {
      if (!source || !keyUrl || !keyPath) {
        reply.code(400);
        return { error: "source, keyUrl, and keyPath are required for repo type" };
      }
      const result = installRepo({ name, source, keyUrl, keyPath, addedBy: "user" });
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, installed: true, alreadyInManifest: result.alreadyInManifest };
    } else {
      reply.code(400);
      return { error: 'type must be "apt", "npm", or "repo"' };
    }
  });

  app.delete<{
    Body: { type: "apt" | "npm" | "repo"; name: string };
  }>("/api/packages", async (req, reply) => {
    const { type, name } = req.body;
    if (!type || !name) {
      reply.code(400);
      return { error: "type and name are required" };
    }
    if (type === "apt") {
      const result = uninstallAptPackage(name);
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, removed: true };
    } else if (type === "npm") {
      const result = uninstallNpmPackage(name);
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, removed: true };
    } else if (type === "repo") {
      const result = uninstallRepo(name);
      if (!result.success) {
        reply.code(500);
        return { error: result.error };
      }
      return { ok: true, removed: true };
    } else {
      reply.code(400);
      return { error: 'type must be "apt", "npm", or "repo"' };
    }
  });

  // Scene save endpoint
  app.put<{
    Params: { id: string };
    Body: SceneConfig;
  }>("/api/scenes/:id", async (req, reply) => {
    const { id } = req.params;
    const config = req.body as SceneConfig;
    if (config.id !== id) {
      reply.code(400);
      return { error: "Scene ID in body does not match URL parameter" };
    }
    const scenePath = join(assetsRoot, "scenes", `${id}.json`);
    writeFileSync(scenePath, JSON.stringify(config, null, 2));
    return { ok: true };
  });

  // User profile endpoint
  app.get("/api/profile", async () => {
    const gearConfigRaw = getConfig("user_gear_config");
    // Resolve COO display name from the custom clone, falling back to "COO"
    const cooRegistryId = getConfig("coo_registry_id");
    const cooEntry = cooRegistryId ? registry.get(cooRegistryId) : null;
    return {
      name: getConfig("user_name") ?? null,
      avatar: getConfig("user_avatar") ?? null,
      bio: getConfig("user_bio") ?? null,
      timezone: getConfig("user_timezone") ?? null,
      modelPackId: getConfig("user_model_pack_id") ?? null,
      gearConfig: gearConfigRaw ? JSON.parse(gearConfigRaw) : null,
      cooName: cooEntry?.name ?? "COO",
    };
  });

  app.put<{
    Body: { modelPackId: string | null; gearConfig?: Record<string, boolean> | null };
  }>("/api/profile/model-pack", async (req) => {
    if (req.body.modelPackId) {
      setConfig("user_model_pack_id", req.body.modelPackId);
    } else {
      deleteConfig("user_model_pack_id");
    }
    if (req.body.gearConfig !== undefined) {
      if (req.body.gearConfig) {
        setConfig("user_gear_config", JSON.stringify(req.body.gearConfig));
      } else {
        deleteConfig("user_gear_config");
      }
    }
    return { ok: true };
  });

  // Agent list endpoint (only active agents, not stale "done" ones)
  app.get("/api/agents", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const { ne } = await import("drizzle-orm");
    const db = getDb();
    return db.select().from(schema.agents).where(ne(schema.agents.status, "done")).all();
  });

  // =========================================================================
  // Settings routes
  // =========================================================================

  app.get("/api/settings", async () => {
    return getSettings();
  });

  // Named provider CRUD
  app.get("/api/settings/providers", async () => {
    return listProviders();
  });

  app.post<{
    Body: { name: string; type: ProviderType; apiKey?: string; baseUrl?: string };
  }>("/api/settings/providers", async (req, reply) => {
    const { name, type, apiKey, baseUrl } = req.body;
    if (!name || !type) {
      reply.code(400);
      return { error: "name and type are required" };
    }
    const validTypes = PROVIDER_TYPE_META.map((m) => m.type);
    if (!validTypes.includes(type)) {
      reply.code(400);
      return { error: `Invalid provider type. Must be one of: ${validTypes.join(", ")}` };
    }
    return createProvider({ name, type, apiKey, baseUrl });
  });

  app.put<{
    Params: { id: string };
    Body: { name?: string; apiKey?: string; baseUrl?: string };
  }>("/api/settings/providers/:id", async (req, reply) => {
    const row = getProviderRow(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: "Provider not found" };
    }
    updateProviderRow(req.params.id, req.body);
    return { ok: true };
  });

  app.delete<{
    Params: { id: string };
  }>("/api/settings/providers/:id", async (req, reply) => {
    const row = getProviderRow(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: "Provider not found" };
    }
    const result = deleteProvider(req.params.id);
    if (!result.ok) {
      reply.code(409);
      return { error: result.error };
    }
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { model?: string };
  }>("/api/settings/providers/:id/test", async (req, reply) => {
    const row = getProviderRow(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: "Provider not found" };
    }
    return testProvider(req.params.id, req.body.model);
  });

  app.get<{
    Params: { id: string };
  }>("/api/settings/providers/:id/models", async (req, reply) => {
    const row = getProviderRow(req.params.id);
    if (!row) {
      reply.code(404);
      return { error: "Provider not found" };
    }
    const models = await fetchModels(req.params.id);
    return { models };
  });

  app.put<{
    Body: Partial<TierDefaults>;
  }>("/api/settings/defaults", async (req) => {
    updateTierDefaults(req.body);
    return { ok: true };
  });

  // Custom models CRUD
  app.get<{
    Querystring: { providerId?: string };
  }>("/api/settings/custom-models", async (req) => {
    return { customModels: listCustomModels(req.query.providerId) };
  });

  app.post<{
    Body: { providerId: string; modelId: string; label?: string };
  }>("/api/settings/custom-models", async (req, reply) => {
    const { providerId, modelId } = req.body;
    if (!providerId || !modelId) {
      reply.code(400);
      return { error: "providerId and modelId are required" };
    }
    const created = createCustomModel(req.body);
    return created;
  });

  app.delete<{
    Params: { id: string };
  }>("/api/settings/custom-models/:id", async (req) => {
    deleteCustomModel(req.params.id);
    return { ok: true };
  });

  // =========================================================================
  // Search settings routes
  // =========================================================================

  app.get("/api/settings/search", async () => {
    return getSearchSettings();
  });

  app.put<{
    Params: { providerId: string };
    Body: { apiKey?: string; baseUrl?: string };
  }>("/api/settings/search/provider/:providerId", async (req) => {
    updateSearchProviderConfig(req.params.providerId, req.body);
    return { ok: true };
  });

  app.put<{
    Body: { providerId: string | null };
  }>("/api/settings/search/active", async (req) => {
    setActiveSearchProvider(req.body.providerId);
    return { ok: true };
  });

  app.post<{
    Params: { providerId: string };
  }>("/api/settings/search/provider/:providerId/test", async (req) => {
    return testSearchProvider(req.params.providerId);
  });

  // =========================================================================
  // TTS settings routes
  // =========================================================================

  app.get("/api/settings/tts", async () => {
    return getTTSSettings();
  });

  app.put<{
    Body: { enabled: boolean };
  }>("/api/settings/tts/enabled", async (req) => {
    setTTSEnabled(req.body.enabled);
    return { ok: true };
  });

  app.put<{
    Body: { providerId: string | null };
  }>("/api/settings/tts/active", async (req) => {
    setActiveTTSProvider(req.body.providerId);
    return { ok: true };
  });

  app.put<{
    Body: { voice: string };
  }>("/api/settings/tts/voice", async (req) => {
    setTTSVoice(req.body.voice);
    return { ok: true };
  });

  app.put<{
    Body: { speed: number };
  }>("/api/settings/tts/speed", async (req) => {
    setTTSSpeed(req.body.speed);
    return { ok: true };
  });

  app.put<{
    Params: { providerId: string };
    Body: { apiKey?: string; baseUrl?: string };
  }>("/api/settings/tts/provider/:providerId", async (req) => {
    updateTTSProviderConfig(req.params.providerId, req.body);
    return { ok: true };
  });

  app.post<{
    Params: { providerId: string };
  }>("/api/settings/tts/provider/:providerId/test", async (req) => {
    return testTTSProvider(req.params.providerId);
  });

  app.post<{
    Body: { voice: string };
  }>("/api/settings/tts/preview", async (req, reply) => {
    const { voice } = req.body;
    if (!voice) {
      reply.code(400);
      return { error: "voice is required" };
    }

    try {
      const provider = getConfiguredTTSProvider();
      if (!provider) {
        reply.code(400);
        return { error: "No TTS provider configured" };
      }

      const speed = parseFloat(getConfig("tts:speed") ?? "1");
      const { audio, contentType } = await provider.synthesize(
        "Hello from your AI assistant.",
        voice,
        speed,
      );

      reply.header("Content-Type", contentType);
      return reply.send(audio);
    } catch (err) {
      reply.code(500);
      return {
        error: err instanceof Error ? err.message : "TTS synthesis failed",
      };
    }
  });

  // =========================================================================
  // STT settings routes
  // =========================================================================

  app.get("/api/settings/stt", async () => {
    return getSTTSettings();
  });

  app.put<{
    Body: { enabled: boolean };
  }>("/api/settings/stt/enabled", async (req) => {
    setSTTEnabled(req.body.enabled);
    return { ok: true };
  });

  app.put<{
    Body: { providerId: string | null };
  }>("/api/settings/stt/active", async (req) => {
    setActiveSTTProvider(req.body.providerId);
    return { ok: true };
  });

  app.put<{
    Body: { language: string };
  }>("/api/settings/stt/language", async (req) => {
    setSTTLanguage(req.body.language);
    return { ok: true };
  });

  app.put<{
    Body: { modelId: string };
  }>("/api/settings/stt/model", async (req) => {
    setSTTModel(req.body.modelId);
    return { ok: true };
  });

  app.put<{
    Params: { providerId: string };
    Body: { apiKey?: string; baseUrl?: string };
  }>("/api/settings/stt/provider/:providerId", async (req) => {
    updateSTTProviderConfig(req.params.providerId, req.body);
    return { ok: true };
  });

  app.post<{
    Params: { providerId: string };
  }>("/api/settings/stt/provider/:providerId/test", async (req) => {
    return testSTTProvider(req.params.providerId);
  });

  // =========================================================================
  // STT transcription route
  // =========================================================================

  app.post("/api/stt/transcribe", async (req, reply) => {
    const provider = getConfiguredSTTProvider();
    if (!provider) {
      reply.code(400);
      return { error: "No STT provider configured" };
    }

    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "No audio file provided" };
    }

    const buffer = await file.toBuffer();
    const language = getConfig("stt:language") || undefined;

    try {
      const result = await provider.transcribe(buffer, { language });
      return { text: result.text };
    } catch (err) {
      reply.code(500);
      return {
        error: err instanceof Error ? err.message : "Transcription failed",
      };
    }
  });

  // =========================================================================
  // OpenCode settings routes
  // =========================================================================

  app.get("/api/settings/opencode", async () => {
    return getOpenCodeSettings();
  });

  app.put<{
    Body: {
      enabled?: boolean;
      apiUrl?: string;
      username?: string;
      password?: string;
      timeoutMs?: number;
      maxIterations?: number;
    };
  }>("/api/settings/opencode", async (req) => {
    updateOpenCodeSettings(req.body);
    return { ok: true };
  });

  app.post("/api/settings/opencode/test", async () => {
    return testOpenCodeConnection();
  });

  // SPA fallback for client-side routing (only for page navigation, not JS/CSS/API requests)
  if (existsSync(webDistPath)) {
    app.setNotFoundHandler(async (req, reply) => {
      const accept = req.headers.accept ?? "";
      // Only serve index.html for browser navigation requests (Accept: text/html)
      // This prevents masking 404s for JS module imports, API calls, etc.
      if (accept.includes("text/html")) {
        return reply.sendFile("index.html");
      }
      reply.code(404);
      return { error: "Not found", path: req.url };
    });
  }

  // Start server
  const port = parseInt(process.env.PORT ?? "62626");
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  console.log(`Smoothbot server listening on https://${host}:${port}`);

  // Graceful shutdown — close Playwright browser if running
  const shutdown = async () => {
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
