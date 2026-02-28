/**
 * Module system entry point.
 * Call initModules() after COO creation to wire everything together.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
import type { FastifyInstance } from "fastify";
import type { Server } from "socket.io";
import type { COO } from "../agents/coo.js";
import type { MessageBus } from "../bus/message-bus.js";
import { ModuleLoader } from "./module-loader.js";
import { ModuleScheduler } from "./module-scheduler.js";
import { registerModuleWebhooks } from "./module-webhook.js";
import { createModuleTools } from "./module-tools.js";
import { getModule, addModule } from "./module-manifest.js";
// ModuleAgent, getConfig, getRandomModelPackId are imported dynamically
// inside spawnModuleAgent() to avoid breaking module system init if
// agent-related deps fail to load.

let _loader: ModuleLoader | null = null;
let _scheduler: ModuleScheduler | null = null;
let _bus: MessageBus | null = null;
let _io: Server | null = null;
/** Active module agents keyed by module instance ID */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _moduleAgents = new Map<string, any>();

export function getModuleLoader(): ModuleLoader | null {
  return _loader;
}

export function getModuleScheduler(): ModuleScheduler | null {
  return _scheduler;
}

export function getModuleAgent(moduleId: string): unknown | undefined {
  return _moduleAgents.get(moduleId);
}

export function getActiveModuleAgents(): Map<string, unknown> {
  return _moduleAgents;
}

export function getModuleBus(): MessageBus | null {
  return _bus;
}

/** Known built-in module directories (checked in order). */
const BUILTIN_MODULE_DIRS = [
  "/app/modules",                              // Docker
  resolve(__dirname, "../../../../modules"),    // dev (relative to packages/server/src/modules/)
];

/**
 * Register built-in modules that ship with the app.
 * Creates disabled manifest entries for any built-in modules not yet tracked.
 */
async function registerBuiltins(): Promise<void> {
  // Find the first existing built-in modules directory
  let builtinRoot: string | null = null;
  for (const dir of BUILTIN_MODULE_DIRS) {
    const abs = resolve(dir);
    if (existsSync(abs)) {
      builtinRoot = abs;
      break;
    }
  }
  if (!builtinRoot) return;

  // Scan for module subdirectories with a package.json
  const { readdirSync } = await import("node:fs");
  let entries: string[];
  try {
    entries = readdirSync(builtinRoot);
  } catch {
    return;
  }

  for (const name of entries) {
    const modulePath = resolve(builtinRoot, name);
    const pkgJsonPath = resolve(modulePath, "package.json");
    if (!existsSync(pkgJsonPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      const moduleId: string | undefined = pkg.otterbot?.id;
      if (!moduleId) continue;

      // Skip if already registered
      const existing = getModule(moduleId);
      if (existing) continue;

      const moduleName = pkg.description ?? pkg.name ?? moduleId;

      console.log(`[Modules] Registering built-in module: ${moduleName}`);

      addModule({
        id: moduleId,
        moduleId,
        name: moduleName,
        version: pkg.version ?? "0.0.0",
        source: "local",
        sourceUri: modulePath,
        enabled: false,
        modulePath,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Not a valid module directory, skip
    }
  }
}

export async function initModules(
  coo: COO,
  app: FastifyInstance,
  bus?: MessageBus,
  io?: Server,
): Promise<void> {
  console.log("[Modules] Initializing module system...");

  // Register built-in modules before loading
  await registerBuiltins();

  const loader = new ModuleLoader();
  const scheduler = new ModuleScheduler();

  _loader = loader;
  _scheduler = scheduler;
  if (bus) _bus = bus;
  if (io) _io = io;

  // 1. Load all modules from manifest
  const modules = await loader.loadAll();

  // 2. Start poll schedulers
  scheduler.startAll(modules);

  // 3. Register webhook routes
  registerModuleWebhooks(app, loader);

  // 4. Register module tools in COO
  const tools = createModuleTools(loader, scheduler);
  coo.setModuleTools(tools);

  // 5. Spawn module agents for modules that declare agent config
  if (bus && io) {
    for (const [id, loaded] of modules) {
      await spawnModuleAgent(id, loaded, bus, io);
    }
  }

  console.log(`[Modules] Module system initialized with ${modules.size} modules`);
}

/** Spawn a module agent for a loaded module (if it declares agent config and is enabled). */
async function spawnModuleAgent(
  moduleId: string,
  loaded: import("./module-loader.js").LoadedModule,
  bus: MessageBus,
  io: Server,
): Promise<unknown | null> {
  const agentConfig = loaded.definition.agent;
  if (!agentConfig) return null;

  // Dynamic imports to avoid breaking module system init if agent deps fail
  const { getConfig } = await import("../auth/auth.js");
  const { ModuleAgent } = await import("../agents/module-agent.js");
  const { getRandomModelPackId } = await import("../models3d/model-packs.js");

  // Check if agent is disabled via config
  const enabledRaw = getConfig(`module:${moduleId}:agent_enabled`);
  if (enabledRaw === "false") return null;

  // Destroy existing agent for this module if any
  destroyModuleAgent(moduleId, io);

  try {
    const agent = new ModuleAgent({
      moduleId,
      agentConfig,
      knowledgeStore: loaded.knowledgeStore,
      moduleContext: loaded.context,
      moduleTools: loaded.definition.tools,
      bus,
      onStatusChange: (agentId: string, status: string) => {
        io.emit("agent:status", { agentId, status });
      },
      onStream: (agentId: string, token: string, messageId: string) => {
        io.emit("agent:stream", { agentId, token, messageId });
      },
    });

    _moduleAgents.set(moduleId, agent);

    // Emit pseudo-agent spawned event for 3D view
    const agentData = agent.toData();
    agentData.modelPackId = agentData.modelPackId ?? getRandomModelPackId();
    io.emit("agent:spawned", agentData);

    console.log(`[Modules] Spawned module agent: ${agent.id}`);
    return agent;
  } catch (err) {
    console.error(`[Modules] Failed to spawn module agent for ${moduleId}:`, err);
    return null;
  }
}

/** Destroy a module agent and clean up. */
function destroyModuleAgent(moduleId: string, io: Server): void {
  const existing = _moduleAgents.get(moduleId);
  if (existing) {
    existing.destroy();
    _moduleAgents.delete(moduleId);
    io.emit("agent:destroyed", { agentId: existing.id });
    console.log(`[Modules] Destroyed module agent: ${existing.id}`);
  }
}

export async function shutdownModules(): Promise<void> {
  // Destroy all module agents
  for (const [, agent] of _moduleAgents) {
    agent.destroy();
  }
  _moduleAgents.clear();

  if (_scheduler) {
    _scheduler.stopAll();
    _scheduler = null;
  }
  if (_loader) {
    await _loader.unloadAll();
    _loader = null;
  }
}
