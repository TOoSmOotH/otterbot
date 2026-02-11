import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
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
import {
  setupSocketHandlers,
  emitAgentSpawned,
  emitCooStream,
} from "./socket/handlers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  await app.register(cors, { origin: true });

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
      cors: { origin: "*" },
    },
  );

  // Start COO agent
  const coo = new COO({
    bus,
    workspace,
    onAgentSpawned: (agent) => {
      emitAgentSpawned(io, agent);
    },
    onStream: (token, messageId) => {
      emitCooStream(io, token, messageId);
    },
  });
  console.log("COO agent started.");

  // Wire up Socket.IO handlers
  setupSocketHandlers(io, bus, coo, registry);

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
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
