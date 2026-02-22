/**
 * Module system entry point.
 * Call initModules() after COO creation to wire everything together.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
import type { FastifyInstance } from "fastify";
import type { COO } from "../agents/coo.js";
import { ModuleLoader } from "./module-loader.js";
import { ModuleScheduler } from "./module-scheduler.js";
import { registerModuleWebhooks } from "./module-webhook.js";
import { createModuleTools } from "./module-tools.js";
import { getModule, addModule } from "./module-manifest.js";

let _loader: ModuleLoader | null = null;
let _scheduler: ModuleScheduler | null = null;

export function getModuleLoader(): ModuleLoader | null {
  return _loader;
}

export function getModuleScheduler(): ModuleScheduler | null {
  return _scheduler;
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
): Promise<void> {
  console.log("[Modules] Initializing module system...");

  // Register built-in modules before loading
  await registerBuiltins();

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
