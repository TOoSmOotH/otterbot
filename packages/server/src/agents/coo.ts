import { nanoid } from "nanoid";
import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
  ProjectStatus,
  CharterStatus,
  type Project,
  type KanbanTask,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { COO_SYSTEM_PROMPT } from "./prompts/coo.js";
import { ConversationContextManager } from "./conversation-context.js";
import { TeamLead } from "./team-lead.js";
import { getDb, schema } from "../db/index.js";
import { Registry } from "../registry/registry.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq } from "drizzle-orm";
import { getConfig } from "../auth/auth.js";
import {
  listPackages,
  installAptPackage,
  uninstallAptPackage,
  installNpmPackage,
  uninstallNpmPackage,
  installRepo,
  uninstallRepo,
} from "../packages/packages.js";
import {
  getSettings,
  updateTierDefaults,
  testProvider,
  getSearchSettings,
  updateSearchProviderConfig,
  setActiveSearchProvider,
  testSearchProvider,
} from "../settings/settings.js";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { getRandomModelPackId } from "../models3d/model-packs.js";

export interface COODependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  onAgentSpawned?: (agent: BaseAgent) => void;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onStream?: (token: string, messageId: string) => void;
  onThinking?: (token: string, messageId: string) => void;
  onThinkingEnd?: (messageId: string) => void;
  onProjectCreated?: (project: Project) => void;
  onProjectUpdated?: (project: Project) => void;
  onKanbanTaskCreated?: (task: KanbanTask) => void;
  onKanbanTaskUpdated?: (task: KanbanTask) => void;
  onKanbanTaskDeleted?: (taskId: string, projectId: string) => void;
}

export class COO extends BaseAgent {
  private teamLeads: Map<string, TeamLead> = new Map();
  private workspace: WorkspaceManager;
  private onAgentSpawned?: (agent: BaseAgent) => void;
  private onStream?: (token: string, messageId: string) => void;
  private onThinking?: (token: string, messageId: string) => void;
  private onThinkingEnd?: (messageId: string) => void;
  private onProjectCreated?: (project: Project) => void;
  private onProjectUpdated?: (project: Project) => void;
  private onKanbanTaskCreated?: (task: KanbanTask) => void;
  private onKanbanTaskUpdated?: (task: KanbanTask) => void;
  private onKanbanTaskDeleted?: (taskId: string, projectId: string) => void;
  private contextManager!: ConversationContextManager;
  private activeContextId: string | null = null;
  private currentConversationId: string | null = null;
  private lastProjectCreatedAt = 0;
  private projectCreatedThisTurn = false;

  constructor(deps: COODependencies) {
    const registry = new Registry();
    const cooRegistryId = getConfig("coo_registry_id");
    // Prefer the custom clone; only fall back to the immutable builtin
    const customCoo = cooRegistryId ? registry.get(cooRegistryId) : null;
    const cooEntry = customCoo ?? registry.get("builtin-coo");
    let systemPrompt = cooEntry?.systemPrompt ?? COO_SYSTEM_PROMPT;

    // Inject user profile into system prompt if available
    const userName = getConfig("user_name");
    if (userName) {
      const userTimezone = getConfig("user_timezone");
      const userBio = getConfig("user_bio");
      const lines = [`## About Your CEO`, `- Name: ${userName}`];
      if (userTimezone) lines.push(`- Timezone: ${userTimezone}`);
      if (userBio) lines.push(`- Bio: ${userBio}`);
      systemPrompt = lines.join("\n") + "\n\n" + systemPrompt;
    }

    // Only use registry model/provider from a custom clone — the builtin's
    // hardcoded values must not override the user's configured provider.
    const options: AgentOptions = {
      id: "coo",
      role: AgentRole.COO,
      parentId: null,
      projectId: null,
      model: customCoo?.defaultModel ?? getConfig("coo_model") ?? "claude-sonnet-4-5-20250929",
      provider: customCoo?.defaultProvider ?? getConfig("coo_provider") ?? "anthropic",
      systemPrompt,
      modelPackId: cooEntry?.modelPackId ?? null,
      gearConfig: cooEntry?.gearConfig ?? null,
      onStatusChange: deps.onStatusChange,
    };
    super(options, deps.bus);
    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
    this.onStream = deps.onStream;
    this.onThinking = deps.onThinking;
    this.onThinkingEnd = deps.onThinkingEnd;
    this.onProjectCreated = deps.onProjectCreated;
    this.onProjectUpdated = deps.onProjectUpdated;
    this.onKanbanTaskCreated = deps.onKanbanTaskCreated;
    this.onKanbanTaskUpdated = deps.onKanbanTaskUpdated;
    this.onKanbanTaskDeleted = deps.onKanbanTaskDeleted;
    this.contextManager = new ConversationContextManager(systemPrompt);
  }

  async handleMessage(message: BusMessage): Promise<void> {
    console.log(`[COO] handleMessage type=${message.type} from=${message.fromAgentId ?? "CEO"}`);
    if (message.type === MessageType.Chat) {
      // CEO is talking to us
      await this.handleCeoMessage(message);
    } else if (message.type === MessageType.Report) {
      // Team Lead reporting back
      await this.handleTeamLeadReport(message);
    }
  }

  private getActiveProjectsSummary(): string {
    const db = getDb();
    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    if (projects.length === 0) return "";

    const lines = projects.map(
      (p) => `- [${p.id}] "${p.name}": ${p.description}`,
    );
    return `\n\n[ACTIVE PROJECTS]\n${lines.join("\n")}\n[/ACTIVE PROJECTS]\n\nConsider the active projects above before deciding whether to create a new one.`;
  }

  private async handleCeoMessage(message: BusMessage) {
    // Track conversation from inbound message
    if (message.conversationId) {
      this.currentConversationId = message.conversationId;
    }

    // Reset per-turn creation guard
    this.projectCreatedThisTurn = false;

    // Swap to the correct conversation context
    const conversationId = this.currentConversationId;
    const projectId = message.metadata?.projectId as string | null ?? null;
    if (conversationId) {
      const ctx = this.contextManager.getOrCreate(conversationId, projectId);
      this.activeContextId = conversationId;
      // Temporarily swap the base class history to this context's history
      this.conversationHistory = ctx.history;
    }

    // Inject active project context so the LLM can avoid duplicates
    const projectContext = this.getActiveProjectsSummary();
    const enrichedContent = projectContext
      ? message.content + projectContext
      : message.content;

    console.log(`[COO] Calling think() — model=${this.llmConfig.model} provider=${this.llmConfig.provider}`);
    const { text, thinking } = await this.think(
      enrichedContent,
      (token, messageId) => {
        this.onStream?.(token, messageId);
      },
      (token, messageId) => {
        this.onThinking?.(token, messageId);
      },
      (messageId) => {
        this.onThinkingEnd?.(messageId);
      },
    );
    console.log(`[COO] think() returned (${text.length} chars): "${text.slice(0, 120)}"`);

    // Send the response back through the bus (to CEO / null)
    this.sendMessage(
      null,
      MessageType.Chat,
      text,
      thinking ? { thinking } : undefined,
      this.currentConversationId ?? undefined,
    );
  }

  private async handleTeamLeadReport(message: BusMessage) {
    // Process the Team Lead's report
    const summary = `[Report from Team Lead ${message.fromAgentId}]: ${message.content}`;
    // Add to conversation so COO remembers context
    this.conversationHistory.push({ role: "user", content: summary });
    // COO may decide to relay to CEO or take action
    const { text, thinking } = await this.think(
      summary,
      (token, messageId) => {
        this.onStream?.(token, messageId);
      },
      (token, messageId) => {
        this.onThinking?.(token, messageId);
      },
      (messageId) => {
        this.onThinkingEnd?.(messageId);
      },
    );

    // If the report is significant, relay to CEO
    if (text.trim()) {
      this.sendMessage(
        null,
        MessageType.Chat,
        text,
        thinking ? { thinking } : undefined,
      );
    }
  }

  protected getTools(): Record<string, unknown> {
    return {
      create_project: tool({
        description:
          "Create a new project and spawn a Team Lead to manage it. Use this when the CEO gives you a new goal or task that requires work. Include a charter summarizing the project's goals, scope, constraints, and deliverables.",
        parameters: z.object({
          name: z
            .string()
            .describe("Short project name"),
          description: z
            .string()
            .describe("Detailed description of what needs to be done"),
          charter: z
            .string()
            .describe(
              "Markdown charter document summarizing the project goals, scope, constraints, and deliverables",
            ),
          directive: z
            .string()
            .describe(
              "The directive to give the Team Lead — what they need to accomplish",
            ),
        }),
        execute: async ({ name, description, charter, directive }) => {
          return this.createProject(name, description, directive, charter);
        },
      }),
      update_charter: tool({
        description:
          "Update a project's charter document. Use this when project scope or goals change.",
        parameters: z.object({
          projectId: z
            .string()
            .describe("The project ID to update"),
          charter: z
            .string()
            .describe("Updated markdown charter document"),
        }),
        execute: async ({ projectId, charter }) => {
          return this.updateCharter(projectId, charter);
        },
      }),
      update_project_status: tool({
        description:
          "Update a project's status. Use this to mark a project as completed, failed, or cancelled.",
        parameters: z.object({
          projectId: z
            .string()
            .describe("The project ID to update"),
          status: z
            .enum(["active", "completed", "failed", "cancelled"])
            .describe("New project status"),
        }),
        execute: async ({ projectId, status }) => {
          return this.updateProjectStatus(projectId, status as "active" | "completed" | "failed" | "cancelled");
        },
      }),
      get_project_status: tool({
        description:
          "Get the status of all active projects or a specific project.",
        parameters: z.object({
          projectId: z
            .string()
            .optional()
            .describe(
              "Specific project ID to check. Leave empty for all projects.",
            ),
        }),
        execute: async ({ projectId }) => {
          return this.getProjectStatus(projectId);
        },
      }),
      manage_models: tool({
        description:
          "Manage LLM providers and model defaults. List configured providers, view/change default models per agent tier (COO, Team Lead, Worker), and test provider connections.",
        parameters: z.object({
          action: z
            .enum([
              "list_providers",
              "get_defaults",
              "set_default",
              "test_provider",
            ])
            .describe("Action to perform"),
          tier: z
            .enum(["coo", "teamLead", "worker"])
            .optional()
            .describe("Agent tier (required for set_default)"),
          provider: z
            .string()
            .optional()
            .describe("Provider ID (required for set_default and test_provider)"),
          model: z
            .string()
            .optional()
            .describe("Model ID (required for set_default, optional for test_provider)"),
        }),
        execute: async (args) => {
          return this.manageModels(args);
        },
      }),
      manage_search: tool({
        description:
          "Manage web search providers. List configured providers, set the active provider, " +
          "configure API keys or base URLs, and test provider connections.",
        parameters: z.object({
          action: z
            .enum([
              "list_providers",
              "set_active",
              "configure",
              "test",
            ])
            .describe("Action to perform"),
          provider: z
            .string()
            .optional()
            .describe("Search provider ID: searxng, brave, or tavily"),
          api_key: z
            .string()
            .optional()
            .describe("API key (for brave or tavily)"),
          base_url: z
            .string()
            .optional()
            .describe("Base URL (for searxng)"),
        }),
        execute: async (args) => {
          return this.manageSearch(args);
        },
      }),
      web_search: tool({
        description:
          "Search the web for information. Returns relevant results for the query.",
        parameters: z.object({
          query: z.string().describe("The search query"),
          maxResults: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe("Maximum number of results to return (default 5, max 20)"),
        }),
        execute: async ({ query, maxResults }) => {
          const provider = getConfiguredSearchProvider();
          if (!provider) {
            return "No search provider configured. Use the manage_search tool to configure one first.";
          }
          try {
            const response = await provider.search(query, maxResults ?? 5);
            if (response.results.length === 0) {
              return `No results found for "${query}".`;
            }
            return response.results
              .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n");
          } catch (err) {
            return `Search error: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      manage_packages: tool({
        description:
          "Manage system packages and apt repositories in the Docker container. " +
          "Supports OS-level (apt) packages, npm global packages, and apt repository sources. " +
          "Everything is installed immediately (no restart needed) and saved to the manifest " +
          "so it persists across container restarts.",
        parameters: z.object({
          action: z
            .enum([
              "add_apt", "remove_apt",
              "add_npm", "remove_npm",
              "add_repo", "remove_repo",
              "list",
            ])
            .describe(
              "Action to perform. add_repo requires repo_name, repo_source, repo_key_url, and repo_key_path.",
            ),
          package_name: z
            .string()
            .optional()
            .describe("Package name (required for apt/npm add/remove actions)"),
          version: z
            .string()
            .optional()
            .describe("Version specifier for npm packages (e.g. 'latest', '^1.0.0')"),
          repo_name: z
            .string()
            .optional()
            .describe("Short repo identifier, e.g. 'nodesource' or 'docker' (required for repo actions)"),
          repo_source: z
            .string()
            .optional()
            .describe(
              "Full deb source line, e.g. 'deb [signed-by=/etc/apt/keyrings/example.gpg] https://example.com/apt stable main'",
            ),
          repo_key_url: z
            .string()
            .optional()
            .describe("URL to the GPG signing key, e.g. 'https://example.com/gpg-key.asc'"),
          repo_key_path: z
            .string()
            .optional()
            .describe("Path to store the dearmored key, e.g. '/etc/apt/keyrings/example.gpg'"),
        }),
        execute: async (args) => {
          return this.managePackages(args);
        },
      }),
    };
  }

  private static readonly PROJECT_COOLDOWN_MS = 60_000; // 60 seconds

  private async createProject(
    name: string,
    description: string,
    directive: string,
    charter?: string,
  ): Promise<string> {
    // Guard: only one project per think() turn
    if (this.projectCreatedThisTurn) {
      return `Blocked: a project was already created during this turn. Use get_project_status to check existing projects instead of creating another.`;
    }

    // Guard: cooldown between project creations
    const elapsed = Date.now() - this.lastProjectCreatedAt;
    if (elapsed < COO.PROJECT_COOLDOWN_MS) {
      const waitSec = Math.ceil((COO.PROJECT_COOLDOWN_MS - elapsed) / 1000);
      return `Blocked: a project was created ${Math.floor(elapsed / 1000)}s ago. Wait ${waitSec}s or use get_project_status to check existing projects.`;
    }

    const projectId = nanoid();
    const db = getDb();

    // Create project record
    db.insert(schema.projects)
      .values({
        id: projectId,
        name,
        description,
        status: ProjectStatus.Active,
        charter: charter ?? null,
        charterStatus: charter ? CharterStatus.Finalized : CharterStatus.Gathering,
        createdAt: new Date().toISOString(),
      })
      .run();

    // Create workspace
    this.workspace.createProject(projectId);

    // Spawn Team Lead
    const teamLead = new TeamLead({
      bus: this.bus,
      workspace: this.workspace,
      projectId,
      parentId: this.id,
      modelPackId: getRandomModelPackId(),
      onAgentSpawned: this.onAgentSpawned,
      onStatusChange: this.onStatusChange,
      onKanbanChange: (event, task) => {
        if (event === "created") this.onKanbanTaskCreated?.(task);
        else if (event === "updated") this.onKanbanTaskUpdated?.(task);
        else if (event === "deleted") this.onKanbanTaskDeleted?.(task.id, task.projectId);
      },
    });

    this.teamLeads.set(projectId, teamLead);

    if (this.onAgentSpawned) {
      this.onAgentSpawned(teamLead);
    }

    // Mark creation guards
    this.projectCreatedThisTurn = true;
    this.lastProjectCreatedAt = Date.now();

    // Send directive to Team Lead
    this.sendMessage(teamLead.id, MessageType.Directive, directive, {
      projectId,
      projectName: name,
    });

    // Emit project:created event
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (project) {
      this.onProjectCreated?.(project as unknown as Project);
    }

    return `Project "${name}" created (${projectId}). Team Lead ${teamLead.id} assigned and directive sent.`;
  }

  private async getProjectStatus(projectId?: string): Promise<string> {
    const db = getDb();

    if (projectId) {
      return this.getSingleProjectStatus(projectId);
    }

    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    if (projects.length === 0) return "No active projects.";

    const summaries = await Promise.all(
      projects.map((p) => this.getSingleProjectStatus(p.id)),
    );
    return summaries.join("\n\n---\n\n");
  }

  private async getSingleProjectStatus(projectId: string): Promise<string> {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (!project) return `Project ${projectId} not found.`;

    // 1. Get agent rows with their current statuses
    const agents = db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.projectId, projectId))
      .all();

    const agentLines = agents.map(
      (a) => `  - ${a.role} ${a.id} [${a.status}]`,
    );

    // 2. Fetch recent bus messages for activity context
    const recentMessages = this.bus.getHistory({
      projectId,
      limit: 5,
    });
    const activityLines = recentMessages.map(
      (m) =>
        `  - [${m.type}] ${m.fromAgentId ?? "CEO"} → ${m.toAgentId ?? "CEO"}: ${m.content.slice(0, 100)}${m.content.length > 100 ? "..." : ""}`,
    );

    // 3. Ask the TeamLead for live status (10s timeout)
    let liveStatus = "  (no TeamLead assigned)";
    const teamLead = this.teamLeads.get(projectId);
    if (teamLead) {
      const reply = await this.bus.request(
        {
          fromAgentId: this.id,
          toAgentId: teamLead.id,
          type: MessageType.StatusRequest,
          content: "status",
          projectId,
        },
        10_000,
      );
      liveStatus = reply
        ? reply.content
        : `  TeamLead ${teamLead.id}: no response (may be busy)`;
    }

    return [
      `**Project "${project.name}"** (${project.status})`,
      `Agents (${agents.length}):`,
      ...agentLines,
      `\nLive status from TeamLead:`,
      liveStatus,
      `\nRecent activity:`,
      ...(activityLines.length > 0
        ? activityLines
        : ["  (no recent messages)"]),
    ].join("\n");
  }

  private async updateProjectStatus(
    projectId: string,
    status: "active" | "completed" | "failed" | "cancelled",
  ): Promise<string> {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (!project) return `Project ${projectId} not found.`;

    db.update(schema.projects)
      .set({ status })
      .where(eq(schema.projects.id, projectId))
      .run();

    const updated = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (updated) {
      this.onProjectUpdated?.(updated as unknown as Project);
    }

    return `Project "${project.name}" status updated to ${status}.`;
  }

  private async updateCharter(projectId: string, charter: string): Promise<string> {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (!project) return `Project ${projectId} not found.`;

    db.update(schema.projects)
      .set({
        charter,
        charterStatus: CharterStatus.Finalized,
      })
      .where(eq(schema.projects.id, projectId))
      .run();

    // Emit project:updated event
    const updated = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();
    if (updated) {
      this.onProjectUpdated?.(updated as unknown as Project);
    }

    return `Charter updated for project "${project.name}".`;
  }

  private async manageModels(args: {
    action: string;
    tier?: string;
    provider?: string;
    model?: string;
  }): Promise<string> {
    const { action, tier, provider, model } = args;

    switch (action) {
      case "list_providers": {
        const settings = getSettings();
        const lines = settings.providers.map((p) => {
          const status = p.apiKeySet || !p.needsApiKey ? "configured" : "not configured";
          const url = p.baseUrl ? ` (${p.baseUrl})` : "";
          return `- **${p.name}** (${p.id}): ${status}${url}`;
        });
        return `**Configured providers:**\n${lines.join("\n")}`;
      }

      case "get_defaults": {
        const settings = getSettings();
        const d = settings.defaults;
        return [
          "**Current model defaults:**",
          `- **COO**: ${d.coo.provider} / ${d.coo.model}`,
          `- **Team Lead**: ${d.teamLead.provider} / ${d.teamLead.model}`,
          `- **Worker**: ${d.worker.provider} / ${d.worker.model}`,
        ].join("\n");
      }

      case "set_default": {
        if (!tier || !provider || !model) {
          return "Error: tier, provider, and model are all required for set_default.";
        }
        const tierMap: Record<string, "coo" | "teamLead" | "worker"> = {
          coo: "coo",
          teamLead: "teamLead",
          worker: "worker",
        };
        const tierKey = tierMap[tier];
        if (!tierKey) return `Error: unknown tier "${tier}".`;

        updateTierDefaults({ [tierKey]: { provider, model } });
        return `Updated ${tier} default to ${provider} / ${model}.`;
      }

      case "test_provider": {
        if (!provider) {
          return "Error: provider is required for test_provider.";
        }
        const result = await testProvider(provider, model);
        if (result.ok) {
          return `Provider "${provider}" is working. Latency: ${result.latencyMs}ms.`;
        }
        return `Provider "${provider}" test failed: ${result.error}`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  }

  private async manageSearch(args: {
    action: string;
    provider?: string;
    api_key?: string;
    base_url?: string;
  }): Promise<string> {
    const { action, provider, api_key, base_url } = args;

    switch (action) {
      case "list_providers": {
        const settings = getSearchSettings();
        const active = settings.activeProvider;
        const lines = settings.providers.map((p) => {
          const configured =
            (p.apiKeySet || !p.needsApiKey) && (!!p.baseUrl || !p.needsBaseUrl);
          const status = configured ? "configured" : "not configured";
          const activeLabel = p.id === active ? " **(active)**" : "";
          const url = p.baseUrl ? ` (${p.baseUrl})` : "";
          return `- **${p.name}** (${p.id}): ${status}${url}${activeLabel}`;
        });
        const header = active
          ? `Active search provider: **${active}**`
          : "No active search provider set.";
        return `${header}\n\n**Search providers:**\n${lines.join("\n")}`;
      }

      case "set_active": {
        if (!provider) {
          return "Error: provider is required for set_active.";
        }
        setActiveSearchProvider(provider);
        return `Active search provider set to "${provider}".`;
      }

      case "configure": {
        if (!provider) {
          return "Error: provider is required for configure.";
        }
        const data: { apiKey?: string; baseUrl?: string } = {};
        if (api_key) data.apiKey = api_key;
        if (base_url) data.baseUrl = base_url;
        if (!data.apiKey && !data.baseUrl) {
          return "Error: at least one of api_key or base_url must be provided.";
        }
        updateSearchProviderConfig(provider, data);
        return `Search provider "${provider}" configuration updated.`;
      }

      case "test": {
        if (!provider) {
          return "Error: provider is required for test.";
        }
        const result = await testSearchProvider(provider);
        if (result.ok) {
          return `Search provider "${provider}" is working. Latency: ${result.latencyMs}ms.`;
        }
        return `Search provider "${provider}" test failed: ${result.error}`;
      }

      default:
        return `Unknown action: ${action}`;
    }
  }

  private managePackages(args: {
    action: string;
    package_name?: string;
    version?: string;
    repo_name?: string;
    repo_source?: string;
    repo_key_url?: string;
    repo_key_path?: string;
  }): string {
    const { action, package_name: packageName, version } = args;

    if (action === "list") {
      const manifest = listPackages();
      if (manifest.apt.length === 0 && manifest.npm.length === 0 && manifest.repos.length === 0) {
        return "No packages or repos configured.";
      }
      const lines: string[] = [];
      if (manifest.repos.length > 0) {
        lines.push("**APT repositories:**");
        for (const r of manifest.repos) {
          lines.push(`- ${r.name}: ${r.source}`);
        }
      }
      if (manifest.apt.length > 0) {
        lines.push("**APT packages:**");
        for (const p of manifest.apt) {
          lines.push(`- ${p.name} (added by ${p.addedBy ?? "unknown"})`);
        }
      }
      if (manifest.npm.length > 0) {
        lines.push("**NPM packages:**");
        for (const p of manifest.npm) {
          const ver = p.version ? `@${p.version}` : "";
          lines.push(`- ${p.name}${ver} (added by ${p.addedBy ?? "unknown"})`);
        }
      }
      return lines.join("\n");
    }

    // Repo actions
    if (action === "add_repo") {
      const { repo_name, repo_source, repo_key_url, repo_key_path } = args;
      if (!repo_name || !repo_source || !repo_key_url || !repo_key_path) {
        return "Error: repo_name, repo_source, repo_key_url, and repo_key_path are all required for add_repo.";
      }
      const result = installRepo({
        name: repo_name,
        source: repo_source,
        keyUrl: repo_key_url,
        keyPath: repo_key_path,
        addedBy: "coo",
      });
      if (!result.success) {
        return `Failed to add repo "${repo_name}": ${result.error}`;
      }
      return result.alreadyInManifest
        ? `Repo "${repo_name}" was already configured.`
        : `Added repo "${repo_name}" and updated apt cache.`;
    }

    if (action === "remove_repo") {
      const { repo_name } = args;
      if (!repo_name) {
        return "Error: repo_name is required for remove_repo.";
      }
      const result = uninstallRepo(repo_name);
      if (!result.success) {
        return `Failed to remove repo "${repo_name}": ${result.error}`;
      }
      return `Removed repo "${repo_name}".`;
    }

    // Package actions
    if (!packageName) {
      return "Error: package_name is required for add/remove package actions.";
    }

    switch (action) {
      case "add_apt": {
        const result = installAptPackage(packageName, "coo");
        if (!result.success) {
          return `Failed to install apt package "${packageName}": ${result.error}`;
        }
        return result.alreadyInManifest
          ? `Apt package "${packageName}" was already in the manifest and is installed.`
          : `Installed apt package "${packageName}" and added to manifest.`;
      }
      case "remove_apt": {
        const result = uninstallAptPackage(packageName);
        if (!result.success) {
          return `Failed to remove apt package "${packageName}": ${result.error}`;
        }
        return `Removed apt package "${packageName}".`;
      }
      case "add_npm": {
        const result = installNpmPackage(packageName, version, "coo");
        if (!result.success) {
          return `Failed to install npm package "${packageName}": ${result.error}`;
        }
        const ver = version ? `@${version}` : "";
        return result.alreadyInManifest
          ? `Npm package "${packageName}${ver}" was already in the manifest and is installed.`
          : `Installed npm package "${packageName}${ver}" and added to manifest.`;
      }
      case "remove_npm": {
        const result = uninstallNpmPackage(packageName);
        if (!result.success) {
          return `Failed to remove npm package "${packageName}": ${result.error}`;
        }
        return `Removed npm package "${packageName}".`;
      }
      default:
        return `Unknown action: ${action}`;
    }
  }

  /** Load a previous conversation by replaying persisted messages */
  loadConversation(conversationId: string, messages: BusMessage[], projectId?: string | null, charter?: string | null) {
    this.currentConversationId = conversationId;
    const ctx = this.contextManager.load(conversationId, projectId ?? null, messages, charter);
    this.activeContextId = conversationId;
    this.conversationHistory = ctx.history;
  }

  /** Start a new conversation (sets ID, resets history) */
  startNewConversation(conversationId: string, projectId?: string | null) {
    this.currentConversationId = conversationId;
    const ctx = this.contextManager.getOrCreate(conversationId, projectId ?? null);
    this.activeContextId = conversationId;
    this.conversationHistory = ctx.history;
  }

  /** Get the current conversation ID */
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  getTeamLeads(): Map<string, TeamLead> {
    return this.teamLeads;
  }
}
