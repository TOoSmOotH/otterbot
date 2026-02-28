/**
 * Module loader — discovers, loads, and manages the lifecycle of modules.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type {
  ModuleDefinition,
  ModuleContext,
  InstalledModule,
  GenerateResponseOptions,
} from "@otterbot/shared";
import { ModuleKnowledgeStore } from "./module-knowledge-store.js";
import { runMigrations } from "./module-migrations.js";
import { listModules, getModule, updateModule } from "./module-manifest.js";
import { getConfig } from "../auth/auth.js";

export interface LoadedModule {
  id: string;
  /** Module type ID from manifest (e.g. "github-discussions") */
  moduleId: string;
  definition: ModuleDefinition;
  context: ModuleContext;
  knowledgeStore: ModuleKnowledgeStore;
  installedModule: InstalledModule;
}

function modulesDir(): string {
  const wsRoot = process.env.WORKSPACE_ROOT ?? "./data";
  return resolve(wsRoot, "modules");
}

function createModuleContext(
  moduleId: string,
  knowledgeStore: ModuleKnowledgeStore,
): ModuleContext {
  return {
    knowledge: knowledgeStore,
    getConfig(key: string): string | undefined {
      // Try module-specific config first, then fall back to global
      return getConfig(`module:${moduleId}:${key}`);
    },
    log(...args: unknown[]) {
      console.log(`[module:${moduleId}]`, ...args);
    },
    warn(...args: unknown[]) {
      console.warn(`[module:${moduleId}]`, ...args);
    },
    error(...args: unknown[]) {
      console.error(`[module:${moduleId}]`, ...args);
    },
    async generateResponse(options: GenerateResponseOptions) {
      const provider = getConfig(`module:${moduleId}:agent_provider`)
        ?? getConfig("worker_provider")
        ?? getConfig("coo_provider")
        ?? "anthropic";
      const model = getConfig(`module:${moduleId}:agent_model`)
        ?? getConfig("worker_model")
        ?? getConfig("coo_model")
        ?? "claude-sonnet-4-5-20250929";

      const { generate } = await import("../llm/adapter.js");
      const messages = [
        { role: "system" as const, content: options.systemPrompt },
        ...options.messages.map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        })),
      ];

      const result = await generate(
        {
          provider,
          model,
          temperature: options.temperature ?? 0.3,
          maxRetries: 3,
          maxSteps: options.maxSteps ?? 8,
        },
        messages,
      );

      return { text: result.text };
    },
  };
}

export class ModuleLoader {
  private modules = new Map<string, LoadedModule>();

  /** Load all enabled modules from the manifest. */
  async loadAll(): Promise<Map<string, LoadedModule>> {
    const installed = listModules();

    for (const entry of installed) {
      if (!entry.enabled) continue;

      try {
        await this.load(entry.id);
      } catch (err) {
        console.error(`[ModuleLoader] Failed to load module ${entry.id}:`, err);
      }
    }

    console.log(`[ModuleLoader] Loaded ${this.modules.size} modules`);
    return this.modules;
  }

  /** Load a single module by ID. */
  async load(id: string): Promise<LoadedModule> {
    const entry = getModule(id);
    if (!entry) {
      throw new Error(`Module not found in manifest: ${id}`);
    }

    // Already loaded?
    if (this.modules.has(id)) {
      return this.modules.get(id)!;
    }

    // Resolve module path
    let modulePath = entry.modulePath;
    if (!existsSync(modulePath)) {
      // Try default data dir
      modulePath = resolve(modulesDir(), id);
      if (!existsSync(modulePath)) {
        throw new Error(`Module path not found: ${entry.modulePath}`);
      }
    }

    // Dynamic import
    const { loadModuleDefinition } = await import("./module-installer.js");
    const definition = await loadModuleDefinition(modulePath);

    // Auto-inject agent config fields into config schema if module declares an agent
    if (definition.agent) {
      if (!definition.configSchema) {
        definition.configSchema = {};
      }
      if (!definition.configSchema.agent_enabled) {
        definition.configSchema.agent_enabled = {
          type: "boolean",
          description: "Enable the module's AI agent for reasoned queries",
          required: false,
          default: true,
        };
      }
      if (!definition.configSchema.agent_name) {
        definition.configSchema.agent_name = {
          type: "string",
          description: "Display name for the module agent",
          required: false,
          default: definition.agent.defaultName,
        };
      }
      if (!definition.configSchema.agent_prompt) {
        definition.configSchema.agent_prompt = {
          type: "string",
          description: "System prompt for the module agent",
          required: false,
          default: definition.agent.defaultPrompt,
        };
      }
      if (!definition.configSchema.agent_model) {
        definition.configSchema.agent_model = {
          type: "string",
          description: "LLM model for the module agent (leave empty for system default)",
          required: false,
        };
      }
      if (!definition.configSchema.agent_provider) {
        definition.configSchema.agent_provider = {
          type: "string",
          description: "LLM provider for the module agent (leave empty for system default)",
          required: false,
        };
      }
      if (!definition.configSchema.agent_posting_mode) {
        definition.configSchema.agent_posting_mode = {
          type: "select",
          description: "Controls when the module agent responds to queries",
          required: false,
          default: "respond",
          options: [
            { value: "respond", label: "Always respond" },
            { value: "lurk", label: "Lurk (index only, never respond)" },
            { value: "new_chats", label: "New conversations only" },
            { value: "permission", label: "Ask COO for permission" },
          ],
        };
      }
    }

    // Create knowledge store (data dir is always in ./data/modules/<id>/)
    const dataDir = resolve(modulesDir(), id);
    const knowledgeStore = new ModuleKnowledgeStore(id, dataDir);

    // Run pending migrations
    if (definition.migrations && definition.migrations.length > 0) {
      runMigrations(knowledgeStore.db, definition.migrations, id);
    }

    // Create context
    const context = createModuleContext(id, knowledgeStore);

    // Call onLoad
    if (definition.onLoad) {
      await definition.onLoad(context);
    }

    const loaded: LoadedModule = {
      id,
      moduleId: entry.moduleId ?? definition.manifest.id,
      definition,
      context,
      knowledgeStore,
      installedModule: entry,
    };

    this.modules.set(id, loaded);
    console.log(`[ModuleLoader] Loaded module: ${definition.manifest.name} v${definition.manifest.version}`);

    return loaded;
  }

  /** Unload a module. */
  async unload(id: string): Promise<void> {
    const loaded = this.modules.get(id);
    if (!loaded) return;

    try {
      if (loaded.definition.onUnload) {
        await loaded.definition.onUnload(loaded.context);
      }
    } catch (err) {
      console.error(`[ModuleLoader] Error during onUnload for ${id}:`, err);
    }

    loaded.knowledgeStore.close();
    this.modules.delete(id);
    console.log(`[ModuleLoader] Unloaded module: ${id}`);
  }

  /** Reload a module (unload + load). */
  async reload(id: string): Promise<LoadedModule> {
    await this.unload(id);
    return this.load(id);
  }

  /** Get a loaded module. */
  get(id: string): LoadedModule | undefined {
    return this.modules.get(id);
  }

  /** Get all loaded modules. */
  getAll(): Map<string, LoadedModule> {
    return this.modules;
  }

  /** Unload all modules. */
  async unloadAll(): Promise<void> {
    for (const id of [...this.modules.keys()]) {
      await this.unload(id);
    }
  }

  /** Toggle a module's enabled state. */
  async toggle(id: string, enabled: boolean): Promise<void> {
    updateModule(id, { enabled });
    if (enabled) {
      try {
        await this.load(id);
      } catch (err) {
        // Revert enabled flag so the UI doesn't show "enabled but not loaded"
        updateModule(id, { enabled: false });
        throw err;
      }
    } else {
      await this.unload(id);
    }
  }
}
