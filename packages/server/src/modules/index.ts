/**
 * Module system entry point.
 * Call initModules() after COO creation to wire everything together.
 */

import type { FastifyInstance } from "fastify";
import type { COO } from "../agents/coo.js";
import { ModuleLoader } from "./module-loader.js";
import { ModuleScheduler } from "./module-scheduler.js";
import { registerModuleWebhooks } from "./module-webhook.js";
import { createModuleTools } from "./module-tools.js";

let _loader: ModuleLoader | null = null;
let _scheduler: ModuleScheduler | null = null;

export function getModuleLoader(): ModuleLoader | null {
  return _loader;
}

export function getModuleScheduler(): ModuleScheduler | null {
  return _scheduler;
}

export async function initModules(
  coo: COO,
  app: FastifyInstance,
): Promise<void> {
  console.log("[Modules] Initializing module system...");

  const loader = new ModuleLoader();
  const scheduler = new ModuleScheduler();

  _loader = loader;
  _scheduler = scheduler;

  // 1. Load all modules from manifest
  const modules = await loader.loadAll();

  // 2. Start poll schedulers
  scheduler.startAll(modules);

  // 3. Register webhook routes
  registerModuleWebhooks(app, loader);

  // 4. Register module tools in COO
  const tools = createModuleTools(loader, scheduler);
  coo.setModuleTools(tools);

  console.log(`[Modules] Module system initialized with ${modules.size} modules`);
}

export async function shutdownModules(): Promise<void> {
  if (_scheduler) {
    _scheduler.stopAll();
    _scheduler = null;
  }
  if (_loader) {
    await _loader.unloadAll();
    _loader = null;
  }
}
