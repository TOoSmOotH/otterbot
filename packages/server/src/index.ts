import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { resolve, dirname, join, sep } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, createReadStream, createWriteStream, copyFileSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  RegistryEntryCreate,
  RegistryEntryUpdate,
  SceneConfig,
  SkillCreate,
  SkillUpdate,
} from "@otterbot/shared";
import { migrateDb, backupDatabase, verifyDatabase, closeDatabase, getDbPath, getDb, schema } from "./db/index.js";
import { MessageBus } from "./bus/message-bus.js";
import { WorkspaceManager } from "./workspace/workspace.js";
import { Registry } from "./registry/registry.js";
import { SkillService } from "./skills/skill-service.js";
import { scanSkillContent } from "./skills/skill-scanner.js";
import { getAvailableToolNames, getToolsWithMeta } from "./tools/tool-factory.js";
import { CustomToolService } from "./tools/custom-tool-service.js";
import { executeCustomTool } from "./tools/custom-tool-executor.js";
import { TOOL_EXAMPLES } from "./tools/tool-examples.js";
import { COO } from "./agents/coo.js";
import { AdminAssistant } from "./agents/admin-assistant.js";
import { closeBrowser } from "./tools/browser-pool.js";
import { setTodoEmitterIO } from "./tools/todo-emitter.js";
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
  emitAgentDestroyed,
  emitCodingAgentEvent,
  emitTerminalData,
  registerPtySession,
  unregisterPtySession,
} from "./socket/handlers.js";
import {
  isSetupComplete,
  isPassphraseSet,
  isPassphraseTemporary,
  hashPassphrase,
  verifyPassphrase,
  getConfig,
  setConfig,
  deleteConfig,
  createSession,
  validateSession,
  destroySession,
  rotateSession,
} from "./auth/auth.js";
import { discoverModelPacks } from "./models3d/model-packs.js";
import { discoverEnvironmentPacks } from "./models3d/environment-packs.js";
import { discoverSceneConfigs } from "./models3d/scene-configs.js";
import { WorldLayoutManager } from "./models3d/world-layout.js";
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
  getAllModelPrices,
  setModelPrice,
  resetModelPrice,
} from "./settings/model-pricing.js";
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
  getClaudeCodeSettings,
  updateClaudeCodeSettings,
  testClaudeCodeConnection,
  getCodexSettings,
  updateCodexSettings,
  testCodexConnection,
  getGitHubSettings,
  updateGitHubSettings,
  testGitHubConnection,
  generateSSHKey,
  importSSHKey,
  getSSHPublicKey,
  removeSSHKey,
  testSSHConnection,
  listCustomModels,
  createCustomModel,
  deleteCustomModel,
  applyGitSSHConfig,
  getClaudeCodeOAuthUsage,
  getAgentModelOverrides,
  setAgentModelOverride,
  clearAgentModelOverride,
  type TierDefaults,
} from "./settings/settings.js";
import type { ProviderType } from "@otterbot/shared";
import { createBackupArchive, restoreFromArchive, looksLikeZip } from "./backup/backup.js";
import { writeOpenCodeConfig } from "./opencode/opencode-manager.js";
import { GitHubIssueMonitor } from "./github/issue-monitor.js";
import { ReminderScheduler } from "./reminders/reminder-scheduler.js";
import { MemoryCompactor } from "./memory/memory-compactor.js";
import { SchedulerRegistry } from "./schedulers/scheduler-registry.js";
import { CustomTaskScheduler, MIN_CUSTOM_TASK_INTERVAL_MS } from "./schedulers/custom-task-scheduler.js";
import { DiscordBridge } from "./discord/discord-bridge.js";
import {
  getDiscordSettings,
  updateDiscordSettings,
  testDiscordConnection,
} from "./discord/discord-settings.js";
import {
  approvePairing,
  rejectPairing,
  revokePairing,
} from "./discord/pairing.js";
import { IrcBridge } from "./irc/irc-bridge.js";
import {
  getIrcSettings,
  updateIrcSettings,
  getIrcConfig,
} from "./irc/irc-settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CORS origin helper
// ---------------------------------------------------------------------------

function getCorsOrigin(): string[] | false {
  const env = process.env.OTTERBOT_ALLOWED_ORIGIN;
  if (!env) return false; // same-origin only
  return env.split(",").map((o) => o.trim()).filter(Boolean);
}

const corsOrigin = getCorsOrigin();

// ---------------------------------------------------------------------------
// Rate limiter (in-memory sliding window)
// ---------------------------------------------------------------------------

class RateLimiter {
  private attempts = new Map<string, number[]>();
  constructor(private maxAttempts: number, private windowMs: number) {}

  check(key: string): boolean {
    const now = Date.now();
    const timestamps = this.attempts.get(key) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false; // rate limited
    }
    recent.push(now);
    this.attempts.set(key, recent);
    return true; // allowed
  }
}

const authLimiter = new RateLimiter(5, 60_000);

// ---------------------------------------------------------------------------
// Public API path whitelist (no auth required)
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = ["/api/setup/status", "/api/setup/passphrase", "/api/auth/login", "/api/oauth/google/callback"];

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
        `-days 365 -nodes -subj "/CN=otterbot"`,
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

  // Bootstrap passphrase from environment (one-time setup)
  if (!isPassphraseSet()) {
    let bootstrapPassphrase: string | undefined;
    
    if (process.env.OTTER_PASSPHRASE_FILE) {
      try {
        bootstrapPassphrase = readFileSync(process.env.OTTER_PASSPHRASE_FILE, "utf-8").trim();
      } catch (err) {
        console.error(`Failed to read OTTER_PASSPHRASE_FILE: ${process.env.OTTER_PASSPHRASE_FILE}`, err);
      }
    } else if (process.env.OTTER_PASSPHRASE) {
      bootstrapPassphrase = process.env.OTTER_PASSPHRASE;
    }
    
    if (bootstrapPassphrase && bootstrapPassphrase.length >= 8) {
      const hash = await hashPassphrase(bootstrapPassphrase);
      setConfig("passphrase_hash", hash);
      setConfig("passphrase_is_temporary", "true");
      console.log("Bootstrap passphrase set from environment. User must change it on first login.");
    }
  }

  // Core services
  const bus = new MessageBus();
  const workspace = new WorkspaceManager();
  const registry = new Registry();
  const skillService = new SkillService();

  // Create Fastify server with HTTPS (required for mic/getUserMedia from remote hosts)
  const dataDir = process.env.WORKSPACE_ROOT ?? resolve(__dirname, "../../../docker/otterbot");
  const tls = ensureSelfSignedCert(join(dataDir, "data"));
  const app = Fastify({ logger: false, https: { key: tls.key, cert: tls.cert } });
  await app.register(cors, { origin: corsOrigin, credentials: true });
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
      cors: { origin: corsOrigin, credentials: true },
    },
  );

  // Allow service-layer modules to emit socket events without passing io around
  setTodoEmitterIO(io);

  // Register VNC WebSocket proxy (must be before Socket.IO starts listening)
  registerDesktopProxy(app, corsOrigin);

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
  let issueMonitor: GitHubIssueMonitor | null = null;
  const schedulerRegistry = new SchedulerRegistry();
  let customTaskScheduler: CustomTaskScheduler | null = null;

  // Resolver map for interactive coding agent sessions: when a Worker awaits human
  // input, a promise is stored here keyed by `${agentId}:${sessionId}`. The
  // frontend sends `codeagent:respond` which resolves it.
  const codingAgentResponseResolvers = new Map<string, (response: string | null) => void>();

  function resolveCodingAgentResponse(agentId: string, sessionId: string, content: string): boolean {
    const key = `${agentId}:${sessionId}`;
    const resolver = codingAgentResponseResolvers.get(key);
    if (!resolver) return false;
    codingAgentResponseResolvers.delete(key);
    resolver(content);
    return true;
  }

  // Resolver map for coding agent permission requests: when a Worker receives a
  // permission.updated event, a promise is stored here keyed by
  // `${agentId}:${permissionId}`. The frontend sends `codeagent:permission-respond`
  // which resolves it. Auto-approves after 5 minutes to prevent session hang.
  const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;
  const codingAgentPermissionResolvers = new Map<string, { resolve: (response: "once" | "always" | "reject") => void; timeout: ReturnType<typeof setTimeout> }>();

  function resolveCodingAgentPermission(agentId: string, permissionId: string, response: "once" | "always" | "reject"): boolean {
    const key = `${agentId}:${permissionId}`;
    const entry = codingAgentPermissionResolvers.get(key);
    if (!entry) return false;
    clearTimeout(entry.timeout);
    codingAgentPermissionResolvers.delete(key);
    entry.resolve(response);
    // Clear active permission if it matches
    if (activePermissionRequest?.permissionId === permissionId) {
      activePermissionRequest = null;
    }
    return true;
  }

  // Track the most recent permission request so chat replies can resolve it
  let activePermissionRequest: { agentId: string; permissionId: string; sessionId: string } | null = null;

  // Discord bridge (initialized when enabled + token set)
  let discordBridge: DiscordBridge | null = null;

  function startDiscordBridge() {
    if (discordBridge || !coo) return;
    const settings = getDiscordSettings();
    if (!settings.enabled || !settings.tokenSet) return;
    const token = getConfig("discord:bot_token");
    if (!token) return;
    discordBridge = new DiscordBridge({ bus, coo, io });
    discordBridge.start(token).catch((err) => {
      console.error("[Discord] Failed to start bridge:", err);
      discordBridge = null;
    });
  }

  async function stopDiscordBridge() {
    if (discordBridge) {
      await discordBridge.stop();
      discordBridge = null;
    }
  }

  // IRC bridge (initialized when enabled + config set)
  let ircBridge: IrcBridge | null = null;

  function startIrcBridge() {
    if (ircBridge || !coo) return;
    const config = getIrcConfig();
    if (!config) return;
    ircBridge = new IrcBridge({ bus, coo, io });
    ircBridge.start(config).catch((err) => {
      console.error("[IRC] Failed to start bridge:", err);
      ircBridge = null;
    });
  }

  async function stopIrcBridge() {
    if (ircBridge) {
      await ircBridge.stop();
      ircBridge = null;
    }
  }

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
        onStream: (token, messageId, conversationId) => {
          emitCooStream(io, token, messageId, conversationId);
        },
        onThinking: (token, messageId, conversationId) => {
          emitCooThinking(io, token, messageId, conversationId);
        },
        onThinkingEnd: (messageId, conversationId) => {
          emitCooThinkingEnd(io, messageId, conversationId);
        },
        onProjectCreated: (project) => {
          emitProjectCreated(io, project);
          // Auto-create a zone for the new project
          const zone = worldLayout.addZone(project.id, undefined, project.name);
          if (zone) {
            io.emit("world:zone-added", { zone });
          }
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
        onCodingAgentEvent: (agentId, sessionId, event) => {
          emitCodingAgentEvent(io, agentId, sessionId, event);
          // Emit a chat message for permission requests so users can approve from chat
          if (event.type === "__permission-request") {
            const permission = event.properties.permission as { id: string; type: string; title: string; pattern?: string | string[] } | undefined;
            if (permission && coo) {
              activePermissionRequest = { agentId, permissionId: permission.id, sessionId };
              const pattern = permission.pattern
                ? `\n\`${Array.isArray(permission.pattern) ? permission.pattern.join("`, `") : permission.pattern}\``
                : "";
              const permissionMsg = bus.send({
                fromAgentId: "coo",
                toAgentId: null,
                type: "chat" as any,
                content: `**Permission Required** — Coding agent wants to **${permission.title || permission.type}**${pattern}\n\nReply **allow**, **always allow**, or **deny**.`,
                conversationId: coo.getCurrentConversationId() ?? undefined,
              });
              io.emit("coo:response", permissionMsg);
            }
          }

          // Clean up pending resolvers when session ends
          if (event.type === "__session-end") {
            const key = `${agentId}:${sessionId}`;
            const resolver = codingAgentResponseResolvers.get(key);
            if (resolver) {
              codingAgentResponseResolvers.delete(key);
              resolver(null);
            }
            // Clean up any pending permission resolvers for this agent
            for (const [pKey, entry] of codingAgentPermissionResolvers) {
              if (pKey.startsWith(`${agentId}:`)) {
                clearTimeout(entry.timeout);
                codingAgentPermissionResolvers.delete(pKey);
                entry.resolve("reject");
              }
            }
            if (activePermissionRequest?.agentId === agentId) {
              activePermissionRequest = null;
            }
          }
        },
        onCodingAgentAwaitingInput: (agentId, sessionId, prompt) => {
          return new Promise<string | null>((resolve) => {
            const key = `${agentId}:${sessionId}`;
            codingAgentResponseResolvers.set(key, resolve);
          });
        },
        onCodingAgentPermissionRequest: (agentId, sessionId, permission) => {
          return new Promise<"once" | "always" | "reject">((resolve) => {
            const key = `${agentId}:${permission.id}`;
            const timeout = setTimeout(() => {
              // Reject on timeout — never auto-approve unattended permission requests
              codingAgentPermissionResolvers.delete(key);
              console.warn(`[CodingAgent] Permission ${permission.id} timed out — rejecting`);
              resolve("reject");
            }, PERMISSION_TIMEOUT_MS);
            codingAgentPermissionResolvers.set(key, { resolve, timeout });
          });
        },
        onTerminalData: (agentId, data) => {
          emitTerminalData(io, agentId, data);
        },
        onPtySessionRegistered: (agentId, client) => {
          registerPtySession(agentId, client);
        },
        onPtySessionUnregistered: (agentId) => {
          unregisterPtySession(agentId);
        },
        onAgentDestroyed: (agentId) => {
          emitAgentDestroyed(io, agentId);
        },
      });
      emitAgentSpawned(io, coo);
      // Create issue monitor
      issueMonitor = new GitHubIssueMonitor(coo, io);

      setupSocketHandlers(io, bus, coo, registry, {
        beforeCeoMessage: (content, conversationId, callback) => {
          if (!activePermissionRequest) return false;

          const lower = content.trim().toLowerCase();
          let response: "once" | "always" | "reject" | null = null;

          if (["allow", "yes", "approve", "ok", "y", "allow once"].includes(lower)) {
            response = "once";
          } else if (["always", "always allow"].includes(lower)) {
            response = "always";
          } else if (["deny", "no", "reject", "n"].includes(lower)) {
            response = "reject";
          }

          if (!response) return false; // Not a permission response — let normal chat flow handle it

          const { agentId, permissionId } = activePermissionRequest;
          const resolved = resolveCodingAgentPermission(agentId, permissionId, response);
          if (!resolved) return false;

          // Emit confirmation message to chat
          const label = response === "reject" ? "denied" : response === "always" ? "set to always allow" : "allowed";
          const confirmMsg = bus.send({
            fromAgentId: "coo",
            toAgentId: null,
            type: "chat" as any,
            content: `Permission ${label}.`,
            conversationId,
          });
          io.emit("coo:response", confirmMsg);

          callback?.({ messageId: confirmMsg.id, conversationId: conversationId ?? "" });
          return true;
        },
      }, { workspace, issueMonitor: issueMonitor! });
      console.log(`COO agent started. (model=${coo.toData().model}, provider=${coo.toData().provider})`);

      // Spawn AdminAssistant alongside COO
      const adminAssistant = new AdminAssistant({
        bus,
        onStatusChange: (agentId, status) => {
          emitAgentStatus(io, agentId, status);
        },
        onStream: (token, messageId) => {
          io.emit("admin-assistant:stream", { token, messageId });
        },
        onThinking: (token, messageId) => {
          io.emit("admin-assistant:thinking", { token, messageId });
        },
        onThinkingEnd: (messageId) => {
          io.emit("admin-assistant:thinking-end", { messageId });
        },
      });
      emitAgentSpawned(io, adminAssistant);
      console.log("AdminAssistant agent started.");

      // Handle admin-assistant messages, codeagent:respond, and scheduler sync from the client
      io.on("connection", (socket) => {
        // Send scheduler pseudo-agents to newly-connected clients so they
        // appear in the 3D view (they aren't in the DB and loadAndStart()
        // fires before clients connect).
        if (customTaskScheduler) {
          for (const agent of customTaskScheduler.getActivePseudoAgents()) {
            socket.emit("agent:spawned", agent);
          }
        }

        socket.on("admin-assistant:message" as any, async (data: { content: string }) => {
          if (!data?.content) return;
          bus.send({
            fromAgentId: null,
            toAgentId: "admin-assistant",
            type: "chat" as any,
            content: data.content,
          });
        });

        socket.on("codeagent:respond", (data, callback) => {
          const resolved = resolveCodingAgentResponse(data.agentId, data.sessionId, data.content);
          callback?.({ ok: resolved, error: resolved ? undefined : "No pending request" });
        });

        socket.on("codeagent:permission-respond", (data, callback) => {
          const resolved = resolveCodingAgentPermission(data.agentId, data.permissionId, data.response);
          callback?.({ ok: resolved, error: resolved ? undefined : "No pending permission request" });
        });
      });

      // Recover active projects from previous run (non-blocking)
      coo.recoverActiveProjects().then(async () => {
        // Ensure office zones exist for all active projects
        const { eq } = await import("drizzle-orm");
        const { getDb, schema } = await import("./db/index.js");
        const db = getDb();
        const activeProjects = db
          .select()
          .from(schema.projects)
          .where(eq(schema.projects.status, "active"))
          .all();
        for (const project of activeProjects) {
          const existing = worldLayout.loadZoneConfig(project.id);
          if (!existing) {
            const zone = worldLayout.addZone(project.id, undefined, project.name);
            if (zone) {
              io.emit("world:zone-added", { zone });
              console.log(`[world] Recreated office zone for project "${project.name}" (${project.id})`);
            }
          }
        }
      }).catch((err) => {
        console.error("Failed to recover active projects:", err);
      });

      // Register schedulers
      const reminderScheduler = new ReminderScheduler(bus, io);
      schedulerRegistry.register("reminder", reminderScheduler, {
        name: "Reminder Scheduler",
        description: "Checks for due reminders and fires notifications.",
        defaultIntervalMs: 30_000,
        minIntervalMs: 5_000,
      });

      const compactor = new MemoryCompactor();
      schedulerRegistry.register("memory-compactor", compactor, {
        name: "Memory Compactor",
        description: "Summarizes daily conversations into episodic memory logs.",
        defaultIntervalMs: 6 * 60 * 60 * 1000,
        minIntervalMs: 60_000,
      });

      if (issueMonitor) {
        issueMonitor.loadFromDb();
        schedulerRegistry.register("github-issues", issueMonitor, {
          name: "GitHub Issue Monitor",
          description: "Polls GitHub for new and updated issues on watched projects.",
          defaultIntervalMs: 60_000,
          minIntervalMs: 5_000,
        });
      }

      schedulerRegistry.startAll();

      // Start custom scheduled tasks
      customTaskScheduler = new CustomTaskScheduler(bus, io);
      customTaskScheduler.loadAndStart();

      // Initialize vector store and backfill embeddings (non-blocking)
      import("./memory/vector-store.js").then(async ({ getVectorStore }) => {
        const store = getVectorStore();
        await store.load();
        // Backfill embeddings for any memories that don't have them yet
        const count = await store.backfillEmbeddings();
        if (count > 0) {
          console.log(`[memory] Backfilled ${count} memory embeddings.`);
        }
      }).catch((err) => {
        console.warn("[memory] Failed to initialize vector store:", err);
      });

      // Initialize module system (non-blocking)
      import("./modules/index.js").then(async ({ initModules }) => {
        await initModules(coo!, app);
      }).catch((err) => {
        console.warn("[modules] Failed to initialize module system:", err);
      });
    } catch (err) {
      console.error("Failed to start COO agent:", err);
    }
  }

  if (isSetupComplete()) {
    startCoo();
    startDiscordBridge();
    startIrcBridge();
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

  app.post<{ Body: { passphrase: string } }>(
    "/api/setup/passphrase",
    async (req, reply) => {
      const clientIp = req.ip;
      if (!authLimiter.check(clientIp)) {
        reply.code(429);
        return { error: "Too many attempts. Try again later." };
      }

      if (isSetupComplete()) {
        reply.code(400);
        return { error: "Setup already completed" };
      }

      if (isPassphraseSet()) {
        reply.code(400);
        return { error: "Passphrase already set. Restart setup to change it." };
      }

      const { passphrase } = req.body;
      if (!passphrase || passphrase.length < 8) {
        reply.code(400);
        return { error: "Passphrase must be at least 8 characters" };
      }

      const hash = await hashPassphrase(passphrase);
      setConfig("passphrase_hash", hash);

      const { token, maxAge } = createSession();
      reply.setCookie("sb_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        maxAge,
      });

      return { ok: true };
    },
  );

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
      adminName: string;
      adminModelPackId?: string;
      adminGearConfig?: Record<string, boolean> | null;
      openCodeEnabled?: boolean;
      openCodeProvider?: string;
      openCodeModel?: string;
      openCodeApiKey?: string;
      openCodeBaseUrl?: string;
      openCodeInteractive?: boolean;
    };
  }>("/api/setup/complete", async (req, reply) => {
    if (isSetupComplete()) {
      reply.code(400);
      return { error: "Setup already completed" };
    }

    if (!isPassphraseSet()) {
      reply.code(400);
      return { error: "Passphrase not set. Start setup from the beginning." };
    }

    const { provider, providerName, model, apiKey, baseUrl, userName, userAvatar, userBio, userTimezone, ttsVoice, ttsProvider, userModelPackId, userGearConfig, cooName, cooModelPackId, cooGearConfig, searchProvider, searchApiKey, searchBaseUrl, adminName, adminModelPackId, adminGearConfig, openCodeEnabled, openCodeProvider, openCodeModel, openCodeApiKey, openCodeBaseUrl, openCodeInteractive } = req.body;

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
    if (!adminName || !adminName.trim()) {
      reply.code(400);
      return { error: "Admin Assistant name is required" };
    }

    const typeMeta = PROVIDER_TYPE_META.find((m) => m.type === provider);
    const namedProvider = createProvider({
      name: providerName || typeMeta?.label || provider,
      type: provider as ProviderType,
      apiKey: apiKey,
      baseUrl: baseUrl,
    });

    setConfig("coo_provider", namedProvider.id);
    setConfig("coo_model", model);

    setConfig("user_name", userName.trim());
    setConfig("user_timezone", userTimezone);
    if (userAvatar) {
      setConfig("user_avatar", userAvatar);
    }
    if (userBio) {
      setConfig("user_bio", userBio.trim());
    }

    if (ttsVoice) {
      setConfig("tts:enabled", "true");
      setConfig("tts:active_provider", ttsProvider || "kokoro");
      setConfig("tts:voice", ttsVoice);
    }

    if (searchProvider) {
      setConfig("search:active_provider", searchProvider);
      if (searchApiKey) setConfig(`search:${searchProvider}:api_key`, searchApiKey);
      if (searchBaseUrl) setConfig(`search:${searchProvider}:base_url`, searchBaseUrl);
    }

    if (userModelPackId) {
      setConfig("user_model_pack_id", userModelPackId);
    }

    if (userGearConfig) {
      setConfig("user_gear_config", JSON.stringify(userGearConfig));
    }

    const cooSource = registry.get("builtin-coo");
    if (cooSource) {
      // Get the skills from the source COO to copy to the clone
      const sourceSkills = skillService.getForAgent("builtin-coo");
      const cooClone = registry.create({
        name: cooName.trim(),
        description: cooSource.description,
        systemPrompt: cooSource.systemPrompt,
        promptAddendum: null,
        defaultModel: model,
        defaultProvider: namedProvider.id,
        role: cooSource.role,
        clonedFromId: "builtin-coo",
        modelPackId: cooModelPackId ?? null,
        gearConfig: cooGearConfig ?? null,
        skillIds: sourceSkills.map((s) => s.id),
      });
      setConfig("coo_registry_id", cooClone.id);
    }

    // Admin Assistant config
    setConfig("admin_assistant_name", adminName.trim());
    if (adminModelPackId) {
      setConfig("admin_assistant_model_pack_id", adminModelPackId);
    }
    if (adminGearConfig) {
      setConfig("admin_assistant_gear_config", JSON.stringify(adminGearConfig));
    }

    // OpenCode coding agent config
    if (openCodeEnabled && openCodeModel) {
      const { nanoid: generateId } = await import("nanoid");

      // Determine if we need a separate provider or reuse the COO's
      let openCodeProviderType = provider;
      let openCodeProviderApiKey = apiKey;
      let openCodeProviderBaseUrl = baseUrl;
      let openCodeProviderId = namedProvider.id;

      if (openCodeProvider && openCodeProvider !== provider) {
        // Create a new provider entry for OpenCode
        openCodeProviderType = openCodeProvider;
        openCodeProviderApiKey = openCodeApiKey;
        openCodeProviderBaseUrl = openCodeBaseUrl;

        const ocProvider = createProvider({
          name: `OpenCode (${openCodeProvider})`,
          type: openCodeProvider as ProviderType,
          apiKey: openCodeApiKey,
          baseUrl: openCodeBaseUrl,
        });
        openCodeProviderId = ocProvider.id;
      }

      // Generate random auth credentials for the local OpenCode server
      const ocUsername = generateId(32);
      const ocPassword = generateId(32);

      // Write OpenCode config file
      writeOpenCodeConfig({
        providerType: openCodeProviderType,
        model: openCodeModel,
        apiKey: openCodeProviderApiKey,
        baseUrl: openCodeProviderBaseUrl,
      });

      // Store OpenCode settings
      setConfig("opencode:enabled", "true");
      setConfig("opencode:api_url", "http://127.0.0.1:4096");
      setConfig("opencode:username", ocUsername);
      setConfig("opencode:password", ocPassword);
      setConfig("opencode:timeout_ms", "300000");
      setConfig("opencode:max_iterations", "200");
      setConfig("opencode:model", openCodeModel);
      setConfig("opencode:provider_type", openCodeProviderType);
      setConfig("opencode:provider_id", openCodeProviderId);
      if (openCodeInteractive) {
        setConfig("opencode:interactive", "true");
      }
    }

    startCoo();
    startDiscordBridge();
    startIrcBridge();

    return { ok: true };
  });

  // --- Auth ---

  app.post<{ Body: { passphrase: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      const clientIp = req.ip;
      if (!authLimiter.check(clientIp)) {
        reply.code(429);
        return { error: "Too many login attempts. Try again later." };
      }

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

      // Rotate session to prevent fixation attacks
      const oldToken = req.cookies.sb_session;
      const { token, maxAge } = rotateSession(oldToken);
      reply.setCookie("sb_session", token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
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

  // --- Google OAuth callback (public — receives redirect from Google) ---

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/api/oauth/google/callback",
    async (req, reply) => {
      const { completeOAuthFlow } = await import("./google/google-auth.js");
      const { code, state, error: oauthError } = req.query;

      let resultPayload: string;
      if (oauthError || !code || !state) {
        resultPayload = JSON.stringify({ ok: false, error: oauthError || "Missing code or state" });
      } else {
        const result = await completeOAuthFlow(code, state);
        resultPayload = JSON.stringify(result);
      }

      // Return an HTML page that posts the result back to the opener window
      reply.type("text/html");
      return `<!DOCTYPE html>
<html><head><title>Google OAuth</title></head>
<body>
<p>Completing authentication...</p>
<script>
  window.opener && window.opener.postMessage({ type: "google-oauth-callback", payload: ${resultPayload} }, "*");
  window.close();
</script>
</body></html>`;
    },
  );

  app.get("/api/auth/check", async (req) => {
    const token = req.cookies.sb_session;
    const authenticated = validateSession(token);
    return { 
      authenticated,
      isTemporary: authenticated && isPassphraseTemporary(),
    };
  });

  app.post<{ Body: { newPassphrase: string } }>(
    "/api/auth/change-temporary-passphrase",
    async (req, reply) => {
      if (!isPassphraseTemporary()) {
        reply.code(400);
        return { error: "Passphrase is not temporary" };
      }

      const { newPassphrase } = req.body;
      if (!newPassphrase || newPassphrase.length < 8) {
        reply.code(400);
        return { error: "New passphrase must be at least 8 characters" };
      }

      const hash = await hashPassphrase(newPassphrase);
      setConfig("passphrase_hash", hash);
      deleteConfig("passphrase_is_temporary");

      return { ok: true };
    },
  );

  // =========================================================================
  // Auth middleware — protects all /api/* routes registered after this hook
  // =========================================================================

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;

    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    const token = req.cookies.sb_session;
    if (!validateSession(token)) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    if (!isSetupComplete()) {
      const allowedDuringSetup = [
        "/api/setup/",
        "/api/auth/",
        "/api/settings/pricing",
        "/api/model-packs",
        "/api/environment-packs",
        "/api/scenes",
      ];
      if (!allowedDuringSetup.some((p) => req.url.startsWith(p))) {
        reply.code(401).send({ error: "Setup incomplete" });
        return;
      }
    }
  });

  // =========================================================================
  // Protected routes
  // =========================================================================

  // Change passphrase
  app.put<{
    Body: { currentPassphrase: string; newPassphrase: string };
  }>("/api/auth/passphrase", async (req, reply) => {
    const { currentPassphrase, newPassphrase } = req.body;

    const storedHash = getConfig("passphrase_hash");
    if (!storedHash) {
      reply.code(500);
      return { error: "No passphrase configured" };
    }

    const valid = await verifyPassphrase(currentPassphrase, storedHash);
    if (!valid) {
      reply.code(401);
      return { error: "Current passphrase is incorrect" };
    }

    if (newPassphrase.length < 6) {
      reply.code(400);
      return { error: "New passphrase must be at least 6 characters" };
    }

    const newHash = await hashPassphrase(newPassphrase);
    setConfig("passphrase_hash", newHash);
    return { ok: true };
  });

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

  app.post<{ Body: RegistryEntryCreate & { skillIds?: string[] } }>(
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

  // Recover a stuck project (tear down old TL + workers, spawn fresh one)
  app.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/recover",
    async (req, reply) => {
      if (!coo) {
        reply.code(503);
        return { error: "COO not running" };
      }
      const result = await coo.recoverLiveProject(req.params.projectId);
      if (!result.ok) {
        reply.code(404);
      }
      return result;
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
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
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
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
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
      if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
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

  // World layout API
  const worldLayout = new WorldLayoutManager(assetsRoot);

  app.get("/api/world", async () => {
    const composite = worldLayout.getCompositeWorld();
    if (!composite) return { error: "No world base scene found" };
    return composite;
  });

  app.post<{
    Body: { projectId: string; templateId?: string };
  }>("/api/world/zones", async (req) => {
    const { projectId, templateId } = req.body;
    const zone = worldLayout.addZone(projectId, templateId ?? "default-project-office");
    if (!zone) return { error: "Failed to create zone" };

    // Emit socket event
    io.emit("world:zone-added", { zone });

    return { ok: true, zone };
  });

  app.delete<{
    Params: { projectId: string };
  }>("/api/world/zones/:projectId", async (req) => {
    const { projectId } = req.params;
    const removed = worldLayout.removeZone(projectId);
    if (!removed) return { error: "Zone not found" };

    io.emit("world:zone-removed", { projectId });

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
      adminName: getConfig("admin_assistant_name") ?? "Admin Assistant",
    };
  });

  app.put<{
    Body: { name: string | null; avatar: string | null; bio: string | null; timezone: string | null };
  }>("/api/profile", async (req) => {
    const { name, avatar, bio, timezone } = req.body;
    if (name) setConfig("user_name", name); else deleteConfig("user_name");
    if (avatar) setConfig("user_avatar", avatar); else deleteConfig("user_avatar");
    if (bio) setConfig("user_bio", bio); else deleteConfig("user_bio");
    if (timezone) setConfig("user_timezone", timezone); else deleteConfig("user_timezone");
    return { ok: true };
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
  // Includes scheduler pseudo-agents that aren't persisted in the DB.
  app.get("/api/agents", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const { ne } = await import("drizzle-orm");
    const db = getDb();
    const dbAgents = db.select().from(schema.agents).where(ne(schema.agents.status, "done")).all();
    const schedulerAgents = customTaskScheduler?.getActivePseudoAgents() ?? [];
    return [...dbAgents, ...schedulerAgents];
  });

  // =========================================================================
  // Backup & Restore routes
  // =========================================================================

  app.get("/api/settings/backup", async (req, reply) => {
    let zipPath: string | undefined;
    try {
      zipPath = await createBackupArchive(dataDir, assetsRoot);

      const stream = createReadStream(zipPath);
      stream.on("close", () => {
        try { if (zipPath) unlinkSync(zipPath); } catch {}
      });

      const datestamp = new Date().toISOString().split("T")[0];
      reply.header("Content-Disposition", `attachment; filename="otterbot-backup-${datestamp}.zip"`);
      reply.header("Content-Type", "application/zip");

      return reply.send(stream);
    } catch (err) {
      try { if (zipPath) unlinkSync(zipPath); } catch {}
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Backup failed" };
    }
  });

  app.post("/api/settings/restore", async (req, reply) => {
    const data = await req.file();
    if (!data) {
      reply.code(400);
      return { error: "No file uploaded" };
    }

    const { nanoid } = await import("nanoid");
    const id = nanoid();
    const tempPath = resolve(dataDir, `restore-${id}.tmp`);

    try {
      await pipeline(data.file, createWriteStream(tempPath));

      const dbKey = process.env.OTTERBOT_DB_KEY;
      if (!dbKey) throw new Error("OTTERBOT_DB_KEY not set");

      const targetDbPath = resolve(getDbPath());

      if (looksLikeZip(tempPath)) {
        // --- ZIP archive path ---
        closeDatabase();
        const { sshKeyRestored } = await restoreFromArchive(
          tempPath,
          dbKey,
          targetDbPath,
          assetsRoot,
        );

        getDb();
        await migrateDb();

        if (sshKeyRestored) {
          applyGitSSHConfig();
        }
      } else {
        // --- Legacy .db path ---
        if (!verifyDatabase(tempPath, dbKey)) {
          throw new Error("Invalid database file or incorrect encryption key");
        }

        closeDatabase();

        if (existsSync(targetDbPath)) {
          copyFileSync(targetDbPath, targetDbPath + ".bak");
        }
        copyFileSync(tempPath, targetDbPath);

        getDb();
        await migrateDb();
      }

      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Restore failed" };
    } finally {
      try { unlinkSync(tempPath); } catch {}
    }
  });

  // =========================================================================
  // Scheduled Tasks routes
  // =========================================================================

  app.get("/api/settings/scheduled-tasks", async () => {
    return { tasks: schedulerRegistry.getAll() };
  });

  app.put<{ Params: { taskId: string }; Body: { enabled?: boolean; intervalMs?: number } }>(
    "/api/settings/scheduled-tasks/:taskId",
    async (req, reply) => {
      const { taskId } = req.params;
      const result = schedulerRegistry.update(taskId, req.body);
      if (!result) {
        reply.code(404);
        return { error: "Unknown scheduler" };
      }
      return { ok: true, task: result };
    },
  );

  // =========================================================================
  // Custom Scheduled Tasks CRUD
  // =========================================================================

  app.get("/api/settings/custom-tasks", async () => {
    const db = getDb();
    const tasks = db.select().from(schema.customScheduledTasks).all();
    return { tasks };
  });

  app.post<{
    Body: {
      name: string;
      description?: string;
      message: string;
      mode?: "coo-prompt" | "coo-background" | "notification";
      intervalMs: number;
      enabled?: boolean;
    };
  }>("/api/settings/custom-tasks", async (req, reply) => {
    const { name, description, message, mode, intervalMs, enabled } = req.body;
    if (!name || !message || !intervalMs) {
      reply.code(400);
      return { error: "name, message, and intervalMs are required" };
    }
    const clampedInterval = Math.max(intervalMs, MIN_CUSTOM_TASK_INTERVAL_MS);
    const { nanoid } = await import("nanoid");
    const now = new Date().toISOString();
    const id = nanoid();
    const db = getDb();
    const task = {
      id,
      name,
      description: description ?? "",
      message,
      mode: (mode ?? "notification") as "coo-prompt" | "coo-background" | "notification",
      intervalMs: clampedInterval,
      enabled: enabled ?? true,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.customScheduledTasks).values(task).run();
    if (task.enabled && customTaskScheduler) {
      customTaskScheduler.startTask(task);
    }
    return { ok: true, task };
  });

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      message?: string;
      mode?: "coo-prompt" | "coo-background" | "notification";
      intervalMs?: number;
      enabled?: boolean;
    };
  }>("/api/settings/custom-tasks/:id", async (req, reply) => {
    const { eq } = await import("drizzle-orm");
    const { id } = req.params;
    const db = getDb();
    const existing = db
      .select()
      .from(schema.customScheduledTasks)
      .where(eq(schema.customScheduledTasks.id, id))
      .get();
    if (!existing) {
      reply.code(404);
      return { error: "Custom task not found" };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.message !== undefined) patch.message = req.body.message;
    if (req.body.mode !== undefined) patch.mode = req.body.mode;
    if (req.body.intervalMs !== undefined) {
      patch.intervalMs = Math.max(req.body.intervalMs, MIN_CUSTOM_TASK_INTERVAL_MS);
    }
    if (req.body.enabled !== undefined) patch.enabled = req.body.enabled;
    db.update(schema.customScheduledTasks)
      .set(patch)
      .where(eq(schema.customScheduledTasks.id, id))
      .run();
    if (customTaskScheduler) {
      customTaskScheduler.restartTask(id);
    }
    const updated = db
      .select()
      .from(schema.customScheduledTasks)
      .where(eq(schema.customScheduledTasks.id, id))
      .get();
    return { ok: true, task: updated };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/settings/custom-tasks/:id",
    async (req, reply) => {
      const { eq } = await import("drizzle-orm");
      const { id } = req.params;
      const db = getDb();
      const existing = db
        .select()
        .from(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .get();
      if (!existing) {
        reply.code(404);
        return { error: "Custom task not found" };
      }
      if (customTaskScheduler) {
        customTaskScheduler.stopTask(id);
      }
      db.delete(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .run();
      return { ok: true };
    },
  );

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

  // Per-agent model overrides
  app.get("/api/settings/agent-model-overrides", async () => {
    return { overrides: getAgentModelOverrides() };
  });

  app.put<{
    Params: { registryEntryId: string };
    Body: { provider: string; model: string };
  }>("/api/settings/agent-model-overrides/:registryEntryId", async (req) => {
    setAgentModelOverride(req.params.registryEntryId, req.body.provider, req.body.model);
    return { ok: true };
  });

  app.delete<{
    Params: { registryEntryId: string };
  }>("/api/settings/agent-model-overrides/:registryEntryId", async (req) => {
    clearAgentModelOverride(req.params.registryEntryId);
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
    await updateOpenCodeSettings(req.body);
    return { ok: true };
  });

  app.post("/api/settings/opencode/test", async () => {
    return testOpenCodeConnection();
  });

  // =========================================================================
  // Claude Code settings routes
  // =========================================================================

  app.get("/api/settings/claude-code", async () => {
    return getClaudeCodeSettings();
  });

  app.put<{
    Body: {
      enabled?: boolean;
      authMode?: "api-key" | "oauth";
      apiKey?: string;
      model?: string;
      approvalMode?: "full-auto" | "auto-edit";
      timeoutMs?: number;
      maxTurns?: number;
    };
  }>("/api/settings/claude-code", async (req) => {
    await updateClaudeCodeSettings(req.body);
    return { ok: true };
  });

  app.post("/api/settings/claude-code/test", async () => {
    return testClaudeCodeConnection();
  });

  app.get("/api/settings/claude-code/usage", async () => {
    return getClaudeCodeOAuthUsage();
  });

  // =========================================================================
  // Codex settings routes
  // =========================================================================

  app.get("/api/settings/codex", async () => {
    return getCodexSettings();
  });

  app.put<{
    Body: {
      enabled?: boolean;
      authMode?: "api-key" | "oauth";
      apiKey?: string;
      model?: string;
      approvalMode?: "full-auto" | "suggest" | "ask";
      timeoutMs?: number;
    };
  }>("/api/settings/codex", async (req) => {
    await updateCodexSettings(req.body);
    return { ok: true };
  });

  app.post("/api/settings/codex/test", async () => {
    return testCodexConnection();
  });

  // =========================================================================
  // Coding agent session history routes
  // =========================================================================

  async function listCodingAgentSessions(query: { limit?: string; projectId?: string; before?: string }) {
    const { getDb, schema } = await import("./db/index.js");
    const { desc, eq, lt, and } = await import("drizzle-orm");
    const db = getDb();
    const limit = Math.min(parseInt(query.limit ?? "20", 10) || 20, 200);
    const conditions = [];
    if (query.projectId) {
      conditions.push(eq(schema.codingAgentSessions.projectId, query.projectId));
    }
    if (query.before) {
      conditions.push(lt(schema.codingAgentSessions.startedAt, query.before));
    }
    const rows = db
      .select()
      .from(schema.codingAgentSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.codingAgentSessions.startedAt))
      .limit(limit + 1)
      .all();
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    return { sessions: rows, hasMore };
  }

  app.get<{
    Querystring: { limit?: string; projectId?: string; before?: string };
  }>("/api/codeagent/sessions", async (req) => {
    return listCodingAgentSessions(req.query);
  });

  // Keep old route for backwards compatibility
  app.get<{
    Querystring: { limit?: string; projectId?: string; before?: string };
  }>("/api/opencode/sessions", async (req) => {
    return listCodingAgentSessions(req.query);
  });

  app.get<{
    Params: { id: string };
  }>("/api/codeagent/sessions/:id", async (req, reply) => {
    const { getDb, schema } = await import("./db/index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const session = db
      .select()
      .from(schema.codingAgentSessions)
      .where(eq(schema.codingAgentSessions.id, req.params.id))
      .get();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    const messages = db
      .select()
      .from(schema.codingAgentMessages)
      .where(eq(schema.codingAgentMessages.sessionId, session.sessionId))
      .all();
    const diffs = db
      .select()
      .from(schema.codingAgentDiffs)
      .where(eq(schema.codingAgentDiffs.sessionId, session.sessionId))
      .all();
    return { session, messages, diffs };
  });

  // Delete a single coding agent session (cascade messages + diffs)
  app.delete<{
    Params: { id: string };
  }>("/api/codeagent/sessions/:id", async (req, reply) => {
    const { getDb, schema } = await import("./db/index.js");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const session = db
      .select()
      .from(schema.codingAgentSessions)
      .where(eq(schema.codingAgentSessions.id, req.params.id))
      .get();
    if (!session) {
      reply.code(404);
      return { error: "Session not found" };
    }
    db.delete(schema.codingAgentMessages)
      .where(eq(schema.codingAgentMessages.sessionId, session.sessionId))
      .run();
    db.delete(schema.codingAgentDiffs)
      .where(eq(schema.codingAgentDiffs.sessionId, session.sessionId))
      .run();
    db.delete(schema.codingAgentSessions)
      .where(eq(schema.codingAgentSessions.id, req.params.id))
      .run();
    return { ok: true };
  });

  // Bulk delete completed/error coding agent sessions
  app.delete("/api/codeagent/sessions", async () => {
    const { getDb, schema } = await import("./db/index.js");
    const { eq, inArray } = await import("drizzle-orm");
    const db = getDb();
    // Find all completed/error sessions
    const toDelete = db
      .select({ id: schema.codingAgentSessions.id, sessionId: schema.codingAgentSessions.sessionId })
      .from(schema.codingAgentSessions)
      .where(
        inArray(schema.codingAgentSessions.status, ["completed", "error"]),
      )
      .all();
    if (toDelete.length === 0) return { ok: true, deleted: 0 };
    const sessionIds = toDelete.map((s) => s.sessionId).filter(Boolean);
    const ids = toDelete.map((s) => s.id);
    if (sessionIds.length > 0) {
      db.delete(schema.codingAgentMessages)
        .where(inArray(schema.codingAgentMessages.sessionId, sessionIds))
        .run();
      db.delete(schema.codingAgentDiffs)
        .where(inArray(schema.codingAgentDiffs.sessionId, sessionIds))
        .run();
    }
    db.delete(schema.codingAgentSessions)
      .where(inArray(schema.codingAgentSessions.id, ids))
      .run();
    return { ok: true, deleted: toDelete.length };
  });

  // =========================================================================
  // Pricing settings routes
  // =========================================================================

  app.get("/api/settings/pricing", async () => {
    return getAllModelPrices();
  });

  app.put<{
    Params: { model: string };
    Body: { inputPerMillion: number; outputPerMillion: number };
  }>("/api/settings/pricing/:model", async (req, reply) => {
    const { inputPerMillion, outputPerMillion } = req.body;
    if (typeof inputPerMillion !== "number" || typeof outputPerMillion !== "number") {
      reply.code(400);
      return { error: "inputPerMillion and outputPerMillion are required numbers" };
    }
    setModelPrice(req.params.model, inputPerMillion, outputPerMillion);
    return { ok: true };
  });

  app.delete<{
    Params: { model: string };
  }>("/api/settings/pricing/:model", async (req) => {
    resetModelPrice(req.params.model);
    return { ok: true };
  });

  // =========================================================================
  // Usage API routes
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; groupBy?: string };
  }>("/api/usage/summary", async (req) => {
    const { getDb, schema } = await import("./db/index.js");
    const { sql, sum, count, gte, lte, and } = await import("drizzle-orm");
    const db = getDb();
    const t = schema.tokenUsage;

    // Build filter conditions
    const conditions = [];
    if (req.query.from) conditions.push(gte(t.timestamp, req.query.from));
    if (req.query.to) conditions.push(lte(t.timestamp, req.query.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const groupBy = req.query.groupBy;

    if (groupBy === "day" || groupBy === "hour") {
      const len = groupBy === "day" ? 10 : 13;
      const periodExpr = sql<string>`substr(${t.timestamp}, 1, ${len})`;
      const rows = db
        .select({
          period: periodExpr.as("period"),
          inputTokens: sum(t.inputTokens).as("inputTokens"),
          outputTokens: sum(t.outputTokens).as("outputTokens"),
          cost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("cost"),
        })
        .from(t)
        .where(where)
        .groupBy(periodExpr)
        .orderBy(periodExpr)
        .all();
      return rows.map((r) => ({
        period: r.period,
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        cost: Number(r.cost ?? 0),
      }));
    }

    if (groupBy === "model") {
      const rows = db
        .select({
          model: t.model,
          inputTokens: sum(t.inputTokens).as("inputTokens"),
          outputTokens: sum(t.outputTokens).as("outputTokens"),
          cost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("cost"),
          count: count().as("count"),
        })
        .from(t)
        .where(where)
        .groupBy(t.model)
        .orderBy(sql`cost DESC`)
        .all();
      return rows.map((r) => ({
        model: r.model,
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        cost: Number(r.cost ?? 0),
        count: Number(r.count),
      }));
    }

    if (groupBy === "agent") {
      const rows = db
        .select({
          agentId: t.agentId,
          inputTokens: sum(t.inputTokens).as("inputTokens"),
          outputTokens: sum(t.outputTokens).as("outputTokens"),
          cost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("cost"),
          count: count().as("count"),
        })
        .from(t)
        .where(where)
        .groupBy(t.agentId)
        .orderBy(sql`cost DESC`)
        .all();
      return rows.map((r) => ({
        agentId: r.agentId,
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        cost: Number(r.cost ?? 0),
        count: Number(r.count),
      }));
    }

    // Default: totals
    const rows = db
      .select({
        totalInputTokens: sum(t.inputTokens).as("totalInputTokens"),
        totalOutputTokens: sum(t.outputTokens).as("totalOutputTokens"),
        totalCost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("totalCost"),
        recordCount: count().as("recordCount"),
      })
      .from(t)
      .where(where)
      .all();
    const row = rows[0];
    return {
      totalInputTokens: Number(row?.totalInputTokens ?? 0),
      totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
      totalCost: Number(row?.totalCost ?? 0),
      recordCount: Number(row?.recordCount ?? 0),
    };
  });

  app.get<{
    Querystring: { from?: string; to?: string };
  }>("/api/usage/by-model", async (req) => {
    const { getDb, schema } = await import("./db/index.js");
    const { sql, sum, count, gte, lte, and } = await import("drizzle-orm");
    const db = getDb();
    const t = schema.tokenUsage;

    const conditions = [];
    if (req.query.from) conditions.push(gte(t.timestamp, req.query.from));
    if (req.query.to) conditions.push(lte(t.timestamp, req.query.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = db
      .select({
        model: t.model,
        inputTokens: sum(t.inputTokens).as("inputTokens"),
        outputTokens: sum(t.outputTokens).as("outputTokens"),
        cost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("cost"),
        count: count().as("count"),
      })
      .from(t)
      .where(where)
      .groupBy(t.model)
      .orderBy(sql`cost DESC`)
      .all();
    return rows.map((r) => ({
      model: r.model,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      cost: Number(r.cost ?? 0),
      count: Number(r.count),
    }));
  });

  app.get<{
    Querystring: { from?: string; to?: string };
  }>("/api/usage/by-agent", async (req) => {
    const { getDb, schema } = await import("./db/index.js");
    const { sql, sum, count, gte, lte, and } = await import("drizzle-orm");
    const db = getDb();
    const t = schema.tokenUsage;

    const conditions = [];
    if (req.query.from) conditions.push(gte(t.timestamp, req.query.from));
    if (req.query.to) conditions.push(lte(t.timestamp, req.query.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = db
      .select({
        agentId: t.agentId,
        inputTokens: sum(t.inputTokens).as("inputTokens"),
        outputTokens: sum(t.outputTokens).as("outputTokens"),
        cost: sql<number>`SUM(COALESCE(${t.cost}, 0))`.as("cost"),
        count: count().as("count"),
      })
      .from(t)
      .where(where)
      .groupBy(t.agentId)
      .orderBy(sql`cost DESC`)
      .all();
    return rows.map((r) => ({
      agentId: r.agentId,
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      cost: Number(r.cost ?? 0),
      count: Number(r.count),
    }));
  });

  app.get<{
    Querystring: { limit?: string };
  }>("/api/usage/recent", async (req) => {
    const { getDb, schema } = await import("./db/index.js");
    const { desc } = await import("drizzle-orm");
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit ?? "50"), 200);
    return db
      .select()
      .from(schema.tokenUsage)
      .orderBy(desc(schema.tokenUsage.timestamp))
      .limit(limit)
      .all();
  });

  // =========================================================================
  // GitHub settings routes
  // =========================================================================

  app.get("/api/settings/github", async () => {
    return getGitHubSettings();
  });

  app.put<{
    Body: {
      enabled?: boolean;
      token?: string;
    };
  }>("/api/settings/github", async (req) => {
    updateGitHubSettings(req.body);
    return { ok: true };
  });

  app.post("/api/settings/github/test", async () => {
    return testGitHubConnection();
  });

  // --- GitHub SSH ---

  app.post<{
    Body: { type?: "ed25519" | "rsa"; comment?: string };
  }>("/api/settings/github/ssh/generate", async (req) => {
    return generateSSHKey(req.body);
  });

  app.post<{
    Body: { privateKey: string };
  }>("/api/settings/github/ssh/import", async (req, reply) => {
    if (!req.body.privateKey) {
      reply.code(400);
      return { error: "privateKey is required" };
    }
    return importSSHKey(req.body.privateKey);
  });

  app.get("/api/settings/github/ssh/public-key", async () => {
    return getSSHPublicKey();
  });

  app.delete("/api/settings/github/ssh", async () => {
    return removeSSHKey();
  });

  app.post("/api/settings/github/ssh/test", async () => {
    return testSSHConnection();
  });

  // =========================================================================
  // Discord settings routes
  // =========================================================================

  app.get("/api/settings/discord", async () => {
    const availableChannels = discordBridge?.getAvailableChannels() ?? [];
    return getDiscordSettings(availableChannels);
  });

  app.put<{
    Body: {
      enabled?: boolean;
      botToken?: string;
      requireMention?: boolean;
      allowedChannels?: string[];
    };
  }>("/api/settings/discord", async (req) => {
    const wasEnabled = getDiscordSettings().enabled && getDiscordSettings().tokenSet;
    updateDiscordSettings(req.body);
    const nowEnabled = getDiscordSettings().enabled && getDiscordSettings().tokenSet;

    // Start or stop bridge based on state change
    if (nowEnabled && !wasEnabled) {
      startDiscordBridge();
    } else if (!nowEnabled && wasEnabled) {
      await stopDiscordBridge();
    }

    return { ok: true };
  });

  app.post("/api/settings/discord/test", async () => {
    return testDiscordConnection();
  });

  app.post<{
    Body: { code: string };
  }>("/api/settings/discord/pair/approve", async (req, reply) => {
    const result = approvePairing(req.body.code);
    if (!result) {
      reply.code(400);
      return { ok: false, error: "Invalid or expired pairing code" };
    }
    return { ok: true, user: result };
  });

  app.post<{
    Body: { code: string };
  }>("/api/settings/discord/pair/reject", async (req, reply) => {
    const ok = rejectPairing(req.body.code);
    if (!ok) {
      reply.code(400);
      return { ok: false, error: "Pairing code not found" };
    }
    return { ok: true };
  });

  app.delete<{
    Params: { userId: string };
  }>("/api/settings/discord/pair/:userId", async (req, reply) => {
    const ok = revokePairing(req.params.userId);
    if (!ok) {
      reply.code(400);
      return { ok: false, error: "User not found" };
    }
    return { ok: true };
  });

  // =========================================================================
  // IRC settings routes
  // =========================================================================

  app.get("/api/settings/irc", async () => {
    return getIrcSettings();
  });

  app.put<{
    Body: {
      enabled?: boolean;
      server?: string;
      port?: number;
      nickname?: string;
      channels?: string[];
      tls?: boolean;
      password?: string;
    };
  }>("/api/settings/irc", async (req) => {
    const wasEnabled = !!getIrcConfig();
    updateIrcSettings(req.body);
    const nowEnabled = !!getIrcConfig();

    if (nowEnabled && !wasEnabled) {
      startIrcBridge();
    } else if (!nowEnabled && wasEnabled) {
      await stopIrcBridge();
    }

    return { ok: true };
  });

  // =========================================================================
  // Google settings routes
  // =========================================================================

  app.get("/api/settings/google", async () => {
    const { getGoogleSettings } = await import("./google/google-auth.js");
    return getGoogleSettings();
  });

  app.put<{
    Body: { clientId?: string; clientSecret?: string; redirectBaseUrl?: string };
  }>("/api/settings/google", async (req) => {
    const { updateGoogleCredentials } = await import("./google/google-auth.js");
    updateGoogleCredentials(req.body);
    return { ok: true };
  });

  app.post("/api/settings/google/oauth/begin", async (req, reply) => {
    const { beginOAuthFlow } = await import("./google/google-auth.js");
    const result = beginOAuthFlow();
    if ("error" in result) {
      reply.code(400);
      return result;
    }
    return result;
  });

  app.post("/api/settings/google/disconnect", async () => {
    const { disconnectGoogle } = await import("./google/google-auth.js");
    disconnectGoogle();
    return { ok: true };
  });

  // =========================================================================
  // Todos REST routes
  // =========================================================================

  app.get<{
    Querystring: { status?: string; priority?: string };
  }>("/api/todos", async (req) => {
    const { listTodos } = await import("./todos/todos.js");
    return listTodos(req.query);
  });

  app.post<{
    Body: { title: string; description?: string; priority?: string; dueDate?: string; reminderAt?: string; tags?: string[] };
  }>("/api/todos", async (req, reply) => {
    const { createTodo } = await import("./todos/todos.js");
    if (!req.body.title) {
      reply.code(400);
      return { error: "title is required" };
    }
    return createTodo(req.body);
  });

  app.put<{
    Params: { id: string };
    Body: { title?: string; description?: string; status?: string; priority?: string; dueDate?: string | null; reminderAt?: string | null; tags?: string[] };
  }>("/api/todos/:id", async (req, reply) => {
    const { updateTodo } = await import("./todos/todos.js");
    const result = updateTodo(req.params.id, req.body);
    if (!result) {
      reply.code(404);
      return { error: "Todo not found" };
    }
    return result;
  });

  app.delete<{
    Params: { id: string };
  }>("/api/todos/:id", async (req, reply) => {
    const { deleteTodo } = await import("./todos/todos.js");
    const ok = deleteTodo(req.params.id);
    if (!ok) {
      reply.code(404);
      return { error: "Todo not found" };
    }
    return { ok: true };
  });

  // =========================================================================
  // Calendar REST routes (local + Google merged)
  // =========================================================================

  app.get<{
    Querystring: { timeMin?: string; timeMax?: string };
  }>("/api/calendar/events", async (req) => {
    const { listLocalEvents } = await import("./calendar/calendar.js");
    const localEvents = listLocalEvents(req.query.timeMin, req.query.timeMax);

    // Try to also fetch Google Calendar events
    let googleEvents: any[] = [];
    try {
      const { listGoogleEvents } = await import("./google/calendar-client.js");
      googleEvents = await listGoogleEvents(req.query.timeMin, req.query.timeMax);
    } catch {
      // Google not connected or error — that's fine
    }

    return [...localEvents, ...googleEvents];
  });

  app.post<{
    Body: { title: string; description?: string; location?: string; start: string; end: string; allDay?: boolean; color?: string; source?: string };
  }>("/api/calendar/events", async (req, reply) => {
    if (!req.body.title || !req.body.start || !req.body.end) {
      reply.code(400);
      return { error: "title, start, and end are required" };
    }
    if (req.body.source === "google") {
      const { createGoogleEvent } = await import("./google/calendar-client.js");
      return createGoogleEvent(req.body);
    }
    const { createLocalEvent } = await import("./calendar/calendar.js");
    return createLocalEvent(req.body);
  });

  app.put<{
    Params: { eventId: string };
    Body: { title?: string; description?: string; location?: string; start?: string; end?: string; allDay?: boolean; color?: string; source?: string };
  }>("/api/calendar/events/:eventId", async (req, reply) => {
    if (req.body.source === "google") {
      const { updateGoogleEvent } = await import("./google/calendar-client.js");
      const result = await updateGoogleEvent(req.params.eventId, req.body);
      if (!result) { reply.code(404); return { error: "Event not found" }; }
      return result;
    }
    const { updateLocalEvent } = await import("./calendar/calendar.js");
    const result = updateLocalEvent(req.params.eventId, req.body);
    if (!result) { reply.code(404); return { error: "Event not found" }; }
    return result;
  });

  app.delete<{
    Params: { eventId: string };
    Querystring: { source?: string };
  }>("/api/calendar/events/:eventId", async (req, reply) => {
    if (req.query.source === "google") {
      const { deleteGoogleEvent } = await import("./google/calendar-client.js");
      const ok = await deleteGoogleEvent(req.params.eventId);
      if (!ok) { reply.code(404); return { error: "Event not found" }; }
      return { ok: true };
    }
    const { deleteLocalEvent } = await import("./calendar/calendar.js");
    const ok = deleteLocalEvent(req.params.eventId);
    if (!ok) { reply.code(404); return { error: "Event not found" }; }
    return { ok: true };
  });

  // =========================================================================
  // Gmail REST routes
  // =========================================================================

  app.get<{
    Querystring: { q?: string; maxResults?: string; pageToken?: string };
  }>("/api/gmail/messages", async (req, reply) => {
    try {
      const { listEmails } = await import("./google/gmail-client.js");
      return await listEmails(req.query);
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Failed to list emails" };
    }
  });

  app.get<{
    Params: { id: string };
  }>("/api/gmail/messages/:id", async (req, reply) => {
    try {
      const { readEmail } = await import("./google/gmail-client.js");
      const email = await readEmail(req.params.id);
      if (!email) { reply.code(404); return { error: "Email not found" }; }
      return email;
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Failed to read email" };
    }
  });

  app.post<{
    Body: { to: string; subject: string; body: string; cc?: string; bcc?: string; inReplyTo?: string; threadId?: string };
  }>("/api/gmail/send", async (req, reply) => {
    try {
      const { sendEmail } = await import("./google/gmail-client.js");
      return await sendEmail(req.body);
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Failed to send email" };
    }
  });

  app.post<{
    Params: { id: string };
  }>("/api/gmail/messages/:id/archive", async (req, reply) => {
    try {
      const { archiveEmail } = await import("./google/gmail-client.js");
      await archiveEmail(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Failed to archive email" };
    }
  });

  app.get("/api/gmail/labels", async (req, reply) => {
    try {
      const { listLabels } = await import("./google/gmail-client.js");
      return await listLabels();
    } catch (err) {
      reply.code(500);
      return { error: err instanceof Error ? err.message : "Failed to list labels" };
    }
  });

  // =========================================================================
  // Skills API
  // =========================================================================

  app.get("/api/skills", async () => {
    return skillService.list();
  });

  app.get<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (req, reply) => {
      const skill = skillService.get(req.params.id);
      if (!skill) {
        reply.code(404);
        return { error: "Not found" };
      }
      return skill;
    },
  );

  app.post<{ Body: SkillCreate }>(
    "/api/skills",
    async (req) => {
      const raw = skillService.serializeSkillFile(req.body.meta, req.body.body);
      const scanReport = scanSkillContent(raw);
      return skillService.create(req.body, scanReport);
    },
  );

  app.put<{ Params: { id: string }; Body: SkillUpdate }>(
    "/api/skills/:id",
    async (req, reply) => {
      const existing = skillService.get(req.params.id);
      if (!existing) {
        reply.code(404);
        return { error: "Not found" };
      }
      if (existing.source === "built-in") {
        reply.code(403);
        return { error: "Built-in skills cannot be modified. Clone it first." };
      }
      const updated = skillService.update(req.params.id, req.body);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/skills/:id",
    async (req, reply) => {
      const existing = skillService.get(req.params.id);
      if (!existing) {
        reply.code(404);
        return { error: "Not found" };
      }
      if (existing.source === "built-in") {
        reply.code(403);
        return { error: "Built-in skills cannot be deleted" };
      }
      skillService.delete(req.params.id);
      return { ok: true };
    },
  );

  // Clone a skill
  app.post<{ Params: { id: string } }>(
    "/api/skills/:id/clone",
    async (req, reply) => {
      const cloned = skillService.clone(req.params.id);
      if (!cloned) {
        reply.code(404);
        return { error: "Not found" };
      }
      return cloned;
    },
  );

  // Import a .md skill file (multipart upload)
  app.post("/api/skills/import", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "No file provided" };
    }
    const raw = (await file.toBuffer()).toString("utf-8");
    const scanReport = scanSkillContent(raw);
    const { meta, body } = skillService.parseSkillFile(raw);
    const skill = skillService.create({ meta, body }, scanReport, { source: "imported" });
    return { skill, scanReport };
  });

  // Scan content without saving
  app.post<{ Body: { content: string } }>(
    "/api/skills/scan",
    async (req) => {
      return scanSkillContent(req.body.content);
    },
  );

  // Export as .md file download
  app.get<{ Params: { id: string } }>(
    "/api/skills/:id/export",
    async (req, reply) => {
      const md = skillService.exportAsMarkdown(req.params.id);
      if (!md) {
        reply.code(404);
        return { error: "Not found" };
      }
      const skill = skillService.get(req.params.id);
      const filename = (skill?.meta.name ?? "skill").replace(/[^a-zA-Z0-9_-]/g, "_") + ".md";
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(md);
    },
  );

  // Available tools for the editor picker
  app.get("/api/tools/available", async () => {
    return { tools: getAvailableToolNames() };
  });

  // =========================================================================
  // Custom Tools CRUD
  // =========================================================================

  const customToolService = new CustomToolService();

  // GET /api/tools — all tools (built-in metadata + custom tools)
  app.get("/api/tools", async () => {
    return getToolsWithMeta();
  });

  // GET /api/tools/examples — curated example tools for custom tool authors
  app.get("/api/tools/examples", async () => {
    return TOOL_EXAMPLES;
  });

  // GET /api/tools/:id — get single custom tool
  app.get<{ Params: { id: string } }>("/api/tools/:id", async (req, reply) => {
    const tool = customToolService.get(req.params.id);
    if (!tool) {
      reply.code(404);
      return { error: "Not found" };
    }
    return tool;
  });

  // POST /api/tools — create custom tool
  app.post<{ Body: { name: string; description: string; parameters: unknown[]; code: string; timeout?: number } }>(
    "/api/tools",
    async (req, reply) => {
      const { name, description, parameters, code, timeout } = req.body;
      if (!name || !code) {
        reply.code(400);
        return { error: "name and code are required" };
      }
      // Validate name is snake_case
      if (!/^[a-z][a-z0-9_]*$/.test(name)) {
        reply.code(400);
        return { error: "name must be snake_case (lowercase letters, numbers, underscores)" };
      }
      // Check name uniqueness against all tools
      const allNames = getAvailableToolNames();
      if (allNames.includes(name)) {
        reply.code(409);
        return { error: `Tool name "${name}" already exists` };
      }
      return customToolService.create({ name, description, parameters: parameters as any, code, timeout });
    },
  );

  // PATCH /api/tools/:id — update custom tool
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; parameters?: unknown[]; code?: string; timeout?: number } }>(
    "/api/tools/:id",
    async (req, reply) => {
      const existing = customToolService.get(req.params.id);
      if (!existing) {
        reply.code(404);
        return { error: "Not found" };
      }
      if (req.body.name && req.body.name !== existing.name) {
        if (!/^[a-z][a-z0-9_]*$/.test(req.body.name)) {
          reply.code(400);
          return { error: "name must be snake_case" };
        }
        if (!customToolService.isNameAvailable(req.body.name, req.params.id)) {
          reply.code(409);
          return { error: `Tool name "${req.body.name}" already exists` };
        }
      }
      return customToolService.update(req.params.id, req.body as any);
    },
  );

  // DELETE /api/tools/:id — delete custom tool
  app.delete<{ Params: { id: string } }>("/api/tools/:id", async (req, reply) => {
    const deleted = customToolService.delete(req.params.id);
    if (!deleted) {
      reply.code(404);
      return { error: "Not found" };
    }
    return { ok: true };
  });

  // POST /api/tools/:id/test — execute tool with test params
  app.post<{ Params: { id: string }; Body: { params: Record<string, unknown> } }>(
    "/api/tools/:id/test",
    async (req, reply) => {
      const tool = customToolService.get(req.params.id);
      if (!tool) {
        reply.code(404);
        return { error: "Not found" };
      }
      try {
        const result = await executeCustomTool(tool, req.body.params ?? {});
        return { result };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { error: message };
      }
    },
  );

  // POST /api/tools/ai-generate — AI-assisted tool generation
  app.post<{ Body: { description: string } }>(
    "/api/tools/ai-generate",
    async (req, reply) => {
      const { description } = req.body;
      if (!description?.trim()) {
        reply.code(400);
        return { error: "description is required" };
      }

      try {
        // Find a configured provider and resolve its model
        const { getDb: getDatabase, schema: dbSchema } = await import("./db/index.js");
        const db = getDatabase();
        const providerRows = db.select().from(dbSchema.providers).all();
        if (providerRows.length === 0) {
          reply.code(400);
          return { error: "No AI provider configured" };
        }

        const provider = providerRows[0];
        let modelId: string;
        switch (provider.type) {
          case "anthropic":
            modelId = "claude-sonnet-4-5-20250929";
            break;
          case "openai":
            modelId = "gpt-4o";
            break;
          default:
            modelId = "claude-sonnet-4-5-20250929";
        }

        const { generateText } = await import("ai");
        const { resolveModel } = await import("./llm/adapter.js");
        const llmModel = resolveModel({ provider: provider.id, model: modelId });

        const result = await generateText({
          model: llmModel,
          system: `You are a tool generation assistant. Given a description, generate a custom JavaScript tool definition.

The tool will run in a sandboxed environment with these globals available:
- fetch, Headers, AbortController (for HTTP requests)
- JSON, Math, Date, URL, URLSearchParams
- TextEncoder, TextDecoder (UTF-8 encoding/decoding)
- atob, btoa (Base64 encoding/decoding)
- setTimeout, setInterval, clearTimeout, clearInterval (timers)
- crypto.randomUUID() (generate unique IDs)
- encodeURIComponent, decodeURIComponent (URL encoding)
- structuredClone (deep object cloning)
- console.log (for debugging)

NOT available: fs, child_process, require, process, Buffer, import

The code must be an async function body that:
- Receives a \`params\` object with the defined parameters
- Must return a string (the tool's output)
- Can use await for async operations

Respond with ONLY a JSON object (no markdown, no explanation) with these fields:
{
  "name": "snake_case_name",
  "description": "What the tool does",
  "parameters": [{"name": "param_name", "type": "string|number|boolean", "required": true, "description": "..."}],
  "code": "// async function body\\nreturn 'result';",
  "timeout": 30000
}`,
          prompt: description,
          maxTokens: 2000,
        });

        // Parse the JSON response
        const text = result.text.trim();
        // Try to extract JSON from the response (handle markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          reply.code(500);
          return { error: "Failed to parse AI response" };
        }
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(500);
        return { error: `AI generation failed: ${message}` };
      }
    },
  );

  // =========================================================================
  // Agent skill assignment routes
  // =========================================================================

  app.get<{ Params: { id: string } }>(
    "/api/registry/:id/skills",
    async (req, reply) => {
      const entry = registry.get(req.params.id);
      if (!entry) {
        reply.code(404);
        return { error: "Not found" };
      }
      return skillService.getForAgent(req.params.id);
    },
  );

  app.put<{ Params: { id: string }; Body: { skillIds: string[] } }>(
    "/api/registry/:id/skills",
    async (req, reply) => {
      const entry = registry.get(req.params.id);
      if (!entry) {
        reply.code(404);
        return { error: "Not found" };
      }
      skillService.setAgentSkills(req.params.id, req.body.skillIds);
      return { ok: true };
    },
  );

  // ─── Module REST API ────────────────────────────────────────────────────────

  app.get("/api/modules", async () => {
    const { getModuleLoader } = await import("./modules/index.js");
    const { listModules } = await import("./modules/module-manifest.js");
    const loader = getModuleLoader();
    const installed = listModules();

    return installed.map((m) => {
      const loaded = loader?.get(m.id);
      return {
        ...m,
        loaded: !!loaded,
        documents: loaded ? loaded.knowledgeStore.count() : 0,
        hasQuery: loaded ? !!loaded.definition.onQuery : false,
      };
    });
  });

  app.post<{ Body: { source: string; uri: string; instanceId?: string } }>(
    "/api/modules/install",
    async (req, reply) => {
      const { source, uri, instanceId } = req.body;
      const { installFromGit, installFromLocal, installFromNpm } = await import(
        "./modules/module-installer.js"
      );
      const { getModuleLoader, getModuleScheduler } = await import("./modules/index.js");

      try {
        let entry;
        switch (source) {
          case "git":
            entry = await installFromGit(uri, instanceId);
            break;
          case "npm":
            entry = await installFromNpm(uri, instanceId);
            break;
          case "local":
            entry = await installFromLocal(uri, instanceId);
            break;
          default:
            return reply.status(400).send({ error: `Invalid source: ${source}` });
        }

        const loader = getModuleLoader();
        const scheduler = getModuleScheduler();
        if (loader) {
          const loaded = await loader.load(entry.id);
          if (scheduler) scheduler.startModule(entry.id, loaded);
        }

        return entry;
      } catch (err) {
        return reply
          .status(500)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { enabled: boolean } }>(
    "/api/modules/:id/toggle",
    async (req, reply) => {
      const { getModuleLoader, getModuleScheduler } = await import("./modules/index.js");
      const loader = getModuleLoader();
      const scheduler = getModuleScheduler();
      if (!loader) return reply.status(503).send({ error: "Module system not initialized" });

      try {
        const { enabled } = req.body;
        if (enabled) {
          await loader.toggle(req.params.id, true);
          const loaded = loader.get(req.params.id);
          if (loaded && scheduler) scheduler.startModule(req.params.id, loaded);
        } else {
          if (scheduler) scheduler.stopModule(req.params.id);
          await loader.toggle(req.params.id, false);
        }
        return { ok: true, enabled };
      } catch (err) {
        return reply
          .status(500)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/modules/:id",
    async (req, reply) => {
      const { getModuleLoader, getModuleScheduler } = await import("./modules/index.js");
      const { uninstallModule } = await import("./modules/module-installer.js");
      const loader = getModuleLoader();
      const scheduler = getModuleScheduler();

      try {
        if (scheduler) scheduler.stopModule(req.params.id);
        if (loader) await loader.unload(req.params.id);
        await uninstallModule(req.params.id);
        return { ok: true };
      } catch (err) {
        return reply
          .status(500)
          .send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

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
  console.log(`Otterbot server listening on https://${host}:${port}`);

  // Graceful shutdown
  const shutdown = async () => {
    await stopDiscordBridge();
    await stopIrcBridge();
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
