import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  RegistryEntryCreate,
  RegistryEntryUpdate,
} from "@smoothbot/shared";
import { migrateDb } from "./db/index.js";
import { MessageBus } from "./bus/message-bus.js";
import { WorkspaceManager } from "./workspace/workspace.js";
import { Registry } from "./registry/registry.js";
import { COO } from "./agents/coo.js";
import { closeBrowser } from "./tools/browser-pool.js";
import {
  setupSocketHandlers,
  emitAgentSpawned,
  emitCooStream,
} from "./socket/handlers.js";
import {
  isSetupComplete,
  getAvailableProviders,
  hashPassphrase,
  verifyPassphrase,
  getConfig,
  setConfig,
  createSession,
  validateSession,
  destroySession,
} from "./auth/auth.js";
import {
  listPackages,
  installAptPackage,
  uninstallAptPackage,
  installNpmPackage,
  uninstallNpmPackage,
  installRepo,
  uninstallRepo,
} from "./packages/packages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Public API path whitelist (no auth required)
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = ["/api/setup/", "/api/auth/"];

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

async function main() {
  // Initialize database
  migrateDb();
  console.log("Database initialized.");

  // Core services
  const bus = new MessageBus();
  const workspace = new WorkspaceManager();
  const registry = new Registry();

  // Create Fastify server
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(fastifyCookie);

  // Serve static web build if it exists
  const webDistPath = resolve(__dirname, "../../web/dist");
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
    });
  }

  // Create Socket.IO server
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    app.server,
    {
      cors: { origin: true, credentials: true },
    },
  );

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
    coo = new COO({
      bus,
      workspace,
      onAgentSpawned: (agent) => {
        emitAgentSpawned(io, agent);
      },
      onStream: (token, messageId) => {
        emitCooStream(io, token, messageId);
      },
    });
    setupSocketHandlers(io, bus, coo, registry);
    console.log("COO agent started.");
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
      providers: getAvailableProviders(),
    };
  });

  app.post<{
    Body: {
      passphrase: string;
      provider: string;
      model: string;
      apiKey?: string;
      baseUrl?: string;
    };
  }>("/api/setup/complete", async (req, reply) => {
    if (isSetupComplete()) {
      reply.code(400);
      return { error: "Setup already completed" };
    }

    const { passphrase, provider, model, apiKey, baseUrl } = req.body;

    if (!passphrase || passphrase.length < 8) {
      reply.code(400);
      return { error: "Passphrase must be at least 8 characters" };
    }
    if (!provider || !model) {
      reply.code(400);
      return { error: "Provider and model are required" };
    }

    // Store config
    const hash = await hashPassphrase(passphrase);
    setConfig("passphrase_hash", hash);
    setConfig("coo_provider", provider);
    setConfig("coo_model", model);

    if (apiKey) {
      setConfig(`provider:${provider}:api_key`, apiKey);
    }
    if (baseUrl) {
      setConfig(`provider:${provider}:base_url`, baseUrl);
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

  app.patch<{ Params: { id: string }; Body: RegistryEntryUpdate }>(
    "/api/registry/:id",
    async (req, reply) => {
      const entry = registry.update(req.params.id, req.body);
      if (!entry) {
        reply.code(404);
        return { error: "Not found" };
      }
      return entry;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/registry/:id",
    async (req, reply) => {
      const deleted = registry.delete(req.params.id);
      if (!deleted) {
        reply.code(404);
        return { error: "Not found" };
      }
      return { ok: true };
    },
  );

  // Message history endpoint
  app.get<{
    Querystring: { projectId?: string; agentId?: string; limit?: string };
  }>("/api/messages", async (req) => {
    return bus.getHistory({
      projectId: req.query.projectId,
      agentId: req.query.agentId,
      limit: req.query.limit ? parseInt(req.query.limit) : undefined,
    });
  });

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

  // Agent list endpoint
  app.get("/api/agents", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const db = getDb();
    return db.select().from(schema.agents).all();
  });

  // SPA fallback for client-side routing
  if (existsSync(webDistPath)) {
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile("index.html");
    });
  }

  // Start server
  const port = parseInt(process.env.PORT ?? "3000");
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
  console.log(`Smoothbot server listening on http://${host}:${port}`);

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
