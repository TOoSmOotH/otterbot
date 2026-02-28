/**
 * COO tools for interacting with the module system.
 */

import { tool } from "ai";
import { z } from "zod";
import { MessageType } from "@otterbot/shared";
import type { ModuleLoader } from "./module-loader.js";
import type { ModuleScheduler } from "./module-scheduler.js";
import {
  installFromGit,
  installFromLocal,
  installFromNpm,
  uninstallModule,
} from "./module-installer.js";
import { getConfig } from "../auth/auth.js";

export function createModuleTools(
  loader: ModuleLoader,
  scheduler: ModuleScheduler,
): Record<string, unknown> {
  return {
    module_list: tool({
      description:
        "List all installed modules with their status, version, and document counts.",
      parameters: z.object({}),
      execute: async () => {
        const modules = loader.getAll();
        const { listModules } = await import("./module-manifest.js");
        const { getModuleAgent } = await import("./index.js");
        const installed = listModules();

        const items = installed.map((m) => {
          const loaded = modules.get(m.id);
          const docCount = loaded ? loaded.knowledgeStore.count() : 0;
          const lastPolled = getConfig(`module:${m.id}:last_polled_at`);

          return {
            id: m.id,
            moduleId: m.moduleId ?? m.id,
            name: m.name,
            version: m.version,
            source: m.source,
            enabled: m.enabled,
            loaded: !!loaded,
            documents: docCount,
            lastPolled: lastPolled ?? null,
            hasQuery: loaded ? !!loaded.definition.onQuery : false,
            hasPoll: loaded ? !!loaded.definition.onPoll : false,
            hasWebhook: loaded ? !!loaded.definition.onWebhook : false,
            hasAgent: loaded ? !!loaded.definition.agent : false,
            agentActive: !!getModuleAgent(m.id),
          };
        });

        return JSON.stringify(items, null, 2);
      },
    }),

    module_query: tool({
      description:
        "Query a specific module's knowledge base. If the module has an active agent, " +
        "it will reason over the query and return a synthesized answer. Otherwise falls " +
        "back to the custom query handler or raw knowledge store search.",
      parameters: z.object({
        moduleId: z.string().describe("The module ID to query"),
        question: z.string().describe("The question or search query"),
      }),
      execute: async ({ moduleId, question }) => {
        const loaded = loader.get(moduleId);
        if (!loaded) {
          return `Error: Module "${moduleId}" is not loaded. Use module_list to see available modules.`;
        }

        try {
          // If the module has an active agent, route through it for reasoned answers
          const { getModuleAgent, getModuleBus } = await import("./index.js");
          const moduleAgent = getModuleAgent(moduleId);
          if (moduleAgent) {
            const bus = getModuleBus();
            if (bus) {
              const agentId = `module-agent-${moduleId}`;
              const reply = await bus.request(
                {
                  fromAgentId: "coo",
                  toAgentId: agentId,
                  type: MessageType.Directive,
                  content: question,
                  metadata: { source: "module_query" },
                },
                120_000, // 2 minute timeout for agent reasoning
              );
              if (reply) {
                return reply.content;
              }
              // Fall through to raw search on timeout
            }
          }

          if (loaded.definition.onQuery) {
            return await loaded.definition.onQuery(question, loaded.context);
          }

          // Fallback to knowledge store search
          const results = await loaded.knowledgeStore.search(question, 5);
          if (results.length === 0) {
            return `No results found in module "${moduleId}" for: ${question}`;
          }

          return results
            .map((doc) => {
              const meta = doc.metadata;
              const url = meta?.url ? ` (${meta.url})` : "";
              return `---\n${doc.content}${url}\n`;
            })
            .join("\n");
        } catch (err) {
          return `Error querying module "${moduleId}": ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    module_install: tool({
      description:
        "Install a new module from a git URL, npm package name, or local file path.",
      parameters: z.object({
        source: z.enum(["git", "npm", "local"]).describe("Installation source type"),
        uri: z
          .string()
          .describe(
            "The source URI: git clone URL, npm package name, or local filesystem path",
          ),
        instanceId: z
          .string()
          .optional()
          .describe("Optional instance ID for multi-instance modules. Defaults to the module's manifest ID."),
      }),
      execute: async ({ source, uri, instanceId }) => {
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
          }

          // Load the newly installed module
          const loaded = await loader.load(entry.id);

          // Start scheduler if applicable
          scheduler.startModule(entry.id, loaded);

          return `Successfully installed module "${entry.name}" v${entry.version} (${source}: ${uri})`;
        } catch (err) {
          return `Failed to install module: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),

    module_toggle: tool({
      description: "Enable or disable an installed module.",
      parameters: z.object({
        moduleId: z.string().describe("The module ID to toggle"),
        enabled: z.boolean().describe("Whether to enable (true) or disable (false) the module"),
      }),
      execute: async ({ moduleId, enabled }) => {
        try {
          if (enabled) {
            await loader.toggle(moduleId, true);
            const loaded = loader.get(moduleId);
            if (loaded) {
              scheduler.startModule(moduleId, loaded);
            }
          } else {
            scheduler.stopModule(moduleId);
            await loader.toggle(moduleId, false);
          }

          return `Module "${moduleId}" has been ${enabled ? "enabled" : "disabled"}.`;
        } catch (err) {
          return `Failed to toggle module: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
  };
}
