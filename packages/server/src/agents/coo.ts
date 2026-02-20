import { makeProjectId } from "../utils/slugify.js";
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
} from "@otterbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { COO_SYSTEM_PROMPT } from "./prompts/coo.js";
import { ConversationContextManager } from "./conversation-context.js";
import { TeamLead } from "./team-lead.js";
import { getDb, schema } from "../db/index.js";
import { Registry } from "../registry/registry.js";
import { SkillService } from "../skills/skill-service.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq, and } from "drizzle-orm";
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
import { isDesktopEnabled } from "../desktop/desktop.js";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

export interface COODependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  onAgentSpawned?: (agent: BaseAgent) => void;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onStream?: (token: string, messageId: string, conversationId: string | null) => void;
  onThinking?: (token: string, messageId: string, conversationId: string | null) => void;
  onThinkingEnd?: (messageId: string, conversationId: string | null) => void;
  onProjectCreated?: (project: Project) => void;
  onProjectUpdated?: (project: Project) => void;
  onKanbanTaskCreated?: (task: KanbanTask) => void;
  onKanbanTaskUpdated?: (task: KanbanTask) => void;
  onKanbanTaskDeleted?: (taskId: string, projectId: string) => void;
  onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
  onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;
  onAgentDestroyed?: (agentId: string) => void;
}

export class COO extends BaseAgent {
  private teamLeads: Map<string, TeamLead> = new Map();
  private workspace: WorkspaceManager;
  private onAgentSpawned?: (agent: BaseAgent) => void;
  private onStream?: (token: string, messageId: string, conversationId: string | null) => void;
  private onThinking?: (token: string, messageId: string, conversationId: string | null) => void;
  private onThinkingEnd?: (messageId: string, conversationId: string | null) => void;
  private onProjectCreated?: (project: Project) => void;
  private onProjectUpdated?: (project: Project) => void;
  private onKanbanTaskCreated?: (task: KanbanTask) => void;
  private onKanbanTaskUpdated?: (task: KanbanTask) => void;
  private onKanbanTaskDeleted?: (taskId: string, projectId: string) => void;
  private _onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  private _onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  private _onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  private _onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
  private _onCodingAgentEvent?: (agentId: string, sessionId: string, event: { type: string; properties: Record<string, unknown> }) => void;
  private _onCodingAgentAwaitingInput?: (agentId: string, sessionId: string, prompt: string) => Promise<string | null>;
  private _onCodingAgentPermissionRequest?: (agentId: string, sessionId: string, permission: { id: string; type: string; title: string; pattern?: string | string[]; metadata: Record<string, unknown> }) => Promise<"once" | "always" | "reject">;
  private onAgentDestroyed?: (agentId: string) => void;
  private allowedToolNames: Set<string>;
  private contextManager!: ConversationContextManager;
  private activeContextId: string | null = null;
  private currentConversationId: string | null = null;
  private lastProjectCreatedAt = 0;
  private projectCreatedThisTurn = false;
  private projectStatusCheckedThisTurn = false;
  /** Per-think-cycle run_command call count — prevents the COO from burning steps on repeated commands */
  private _runCommandCalls = 0;

  constructor(deps: COODependencies) {
    const registry = new Registry();
    const cooRegistryId = getConfig("coo_registry_id");
    // Prefer the custom clone; only fall back to the immutable builtin
    const customCoo = cooRegistryId ? registry.get(cooRegistryId) : null;
    const cooEntry = customCoo ?? registry.get("builtin-coo");

    // Always start with the canonical base prompt so updates flow through
    let systemPrompt = COO_SYSTEM_PROMPT;

    // Append the user's addendum if the custom clone has one
    if (customCoo?.promptAddendum) {
      systemPrompt += "\n\n" + customCoo.promptAddendum;
    }

    // Inject desktop environment context
    if (isDesktopEnabled()) {
      let chromiumPath = "chromium-browser";
      try {
        execSync("which chromium-browser", { stdio: "pipe" });
      } catch {
        // Fallback: find Playwright's Chrome binary
        try {
          const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? `${process.env.HOME ?? "/root"}/.cache/ms-playwright`;
          chromiumPath = execSync(
            `find ${browsersPath} -name chrome -type f -path '*/chrome-linux*/chrome' 2>/dev/null | head -1`,
            { stdio: "pipe" },
          ).toString().trim() || "chromium-browser";
        } catch { /* use default */ }
      }
      systemPrompt += `\n\n## Desktop Environment
A full XFCE4 desktop is running on DISPLAY=:99, viewable by the user via the web UI.
Chromium is already installed at \`${chromiumPath}\`. Do NOT try to install a browser.
To launch it: use run_command with \`${chromiumPath} --no-sandbox --disable-dev-shm-usage <url> &\`
The user can see everything on the desktop in real-time.`;
    }

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
    // Cap the COO's tool-call rounds — it should never need more than a few
    // tool calls per think(). The default maxSteps=20 lets smaller models
    // loop endlessly between blocked tools.
    this.llmConfig.maxSteps = 5;

    // Derive allowed tools from assigned skills
    const skillService = new SkillService();
    const cooEntryId = cooRegistryId ?? "builtin-coo";
    const skills = skillService.getForAgent(cooEntryId);
    this.allowedToolNames = new Set(skills.flatMap((s) => s.meta.tools));

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
    this._onAgentStream = deps.onAgentStream;
    this._onAgentThinking = deps.onAgentThinking;
    this._onAgentThinkingEnd = deps.onAgentThinkingEnd;
    this._onAgentToolCall = deps.onAgentToolCall;
    this._onCodingAgentEvent = deps.onCodingAgentEvent;
    this._onCodingAgentAwaitingInput = deps.onCodingAgentAwaitingInput;
    this._onCodingAgentPermissionRequest = deps.onCodingAgentPermissionRequest;
    this.onAgentDestroyed = deps.onAgentDestroyed;
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
    return `\n\n[ACTIVE PROJECTS]\n${lines.join("\n")}\n[/ACTIVE PROJECTS]\n\nRoute related work to an existing project with send_directive, or create a new project if this is a distinct area of work.`;
  }

  private async handleCeoMessage(message: BusMessage) {
    // Track conversation from inbound message
    if (message.conversationId) {
      this.currentConversationId = message.conversationId;
    }

    // Reset per-turn guards
    this.projectCreatedThisTurn = false;
    this.projectStatusCheckedThisTurn = false;

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
        this.onStream?.(token, messageId, this.currentConversationId);
      },
      (token, messageId) => {
        this.onThinking?.(token, messageId, this.currentConversationId);
      },
      (messageId) => {
        this.onThinkingEnd?.(messageId, this.currentConversationId);
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
    // Reset per-turn guards for this new think cycle
    this.projectStatusCheckedThisTurn = false;

    // Process the Team Lead's report with a strong instruction to relay.
    // Use thinkWithoutTools so the COO just summarises instead of looping
    // on get_project_status or other tools — it only needs to relay.
    const summary = `[IMPORTANT: Summarize this report and relay it to the CEO immediately. Do NOT call any tools — just write your summary.]\n\n[Report from Team Lead ${message.fromAgentId}]: ${message.content}`;
    const { text, thinking } = await this.thinkWithoutTools(
      summary,
      (token, messageId) => {
        this.onStream?.(token, messageId, this.currentConversationId);
      },
      (token, messageId) => {
        this.onThinking?.(token, messageId, this.currentConversationId);
      },
      (messageId) => {
        this.onThinkingEnd?.(messageId, this.currentConversationId);
      },
    );

    // Always relay to CEO — fall back to a raw snippet if LLM returns empty
    const relay = text.trim()
      ? text
      : `Update from Team Lead: ${message.content.slice(0, 500)}${message.content.length > 500 ? "..." : ""}`;
    this.sendMessage(
      null,
      MessageType.Chat,
      relay,
      thinking ? { thinking } : undefined,
    );
  }

  /** Reset per-cycle tool call counters before each LLM invocation */
  protected override async think(
    userMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean }> {
    this._runCommandCalls = 0;
    return super.think(userMessage, onToken, onReasoning, onReasoningEnd);
  }

  /**
   * Run LLM inference WITHOUT tools — prevents the LLM from looping on
   * tool calls when it only needs to summarise or relay information.
   */
  private async thinkWithoutTools(
    userMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean }> {
    // Temporarily disable tools by swapping getTools
    const origGetTools = this.getTools.bind(this);
    this.getTools = () => ({});
    try {
      return await super.think(userMessage, onToken, onReasoning, onReasoningEnd);
    } finally {
      this.getTools = origGetTools;
    }
  }

  protected getTools(): Record<string, unknown> {
    const allTools: Record<string, unknown> = this.getAllCooTools();

    // Filter to only the tools declared by assigned skills
    if (this.allowedToolNames.size > 0) {
      const filtered: Record<string, unknown> = {};
      for (const [name, t] of Object.entries(allTools)) {
        if (this.allowedToolNames.has(name)) {
          filtered[name] = t;
        }
      }
      return filtered;
    }

    return allTools;
  }

  /** All possible COO tools — filtered by skills in getTools() */
  private getAllCooTools(): Record<string, unknown> {
    return {
      run_command: tool({
        description:
          "Run ONE quick shell command for system-level checks only (e.g. docker ps, uptime, df). " +
          "NEVER use this to explore project files, list directories, check services, or inspect code — " +
          "that is the Team Lead's job. Use send_directive to tell the Team Lead what to do. " +
          "You get at most 1 command per turn. Output is capped at 50KB. Default timeout: 30s, max: 120s.",
        parameters: z.object({
          command: z.string().describe("The shell command to execute"),
          projectId: z.string().optional().describe("Project ID — sets working directory to the project's repo"),
          timeout: z
            .number()
            .optional()
            .describe("Timeout in milliseconds (default: 30000, max: 120000)"),
        }),
        execute: async ({ command, projectId, timeout }) => {
          this._runCommandCalls++;
          if (this._runCommandCalls > 1) {
            return "REFUSED: You already used your one command this turn. " +
              "STOP and use send_directive to delegate work to the Team Lead. Do NOT run more commands.";
          }
          const effectiveTimeout = Math.min(timeout ?? 30_000, 120_000);
          let cwd: string | undefined;
          if (projectId) {
            const repoDir = this.workspace.repoPath(projectId);
            cwd = existsSync(repoDir) ? repoDir : this.workspace.projectPath(projectId);
          }
          try {
            const output = execSync(command, {
              cwd,
              timeout: effectiveTimeout,
              stdio: "pipe",
              maxBuffer: 1024 * 1024,
              env: { ...process.env },
            });
            const text = output.toString();
            if (text.length > 50_000) {
              return text.slice(0, 50_000) + `\n\n[Output truncated at 50KB. Total: ${text.length} bytes]`;
            }
            return text || "(no output)";
          } catch (err: unknown) {
            const execErr = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
            const stderr = execErr.stderr?.toString() ?? "";
            const stdout = execErr.stdout?.toString() ?? "";
            const combined = `Exit code: ${execErr.status ?? "unknown"}\nstdout: ${stdout}\nstderr: ${stderr}`;
            return combined.length > 50_000 ? combined.slice(0, 50_000) + "\n[truncated]" : combined;
          }
        },
      }),
      create_project: tool({
        description:
          "Create a NEW project and spawn a Team Lead. ONLY use this when no active project covers the CEO's goal. Always call get_project_status first to check existing projects. Prefer send_directive if an existing project can handle the work.",
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
      send_directive: tool({
        description:
          "Send an additional directive to an existing project's Team Lead. ALWAYS prefer this over create_project when the CEO's request relates to an active project.",
        parameters: z.object({
          projectId: z
            .string()
            .describe("The project ID to send the directive to"),
          directive: z
            .string()
            .describe("The directive for the Team Lead"),
        }),
        execute: async ({ projectId, directive }) => {
          return this.sendDirectiveToTeamLead(projectId, directive);
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
          "Get the status of all active projects or a specific project. Always call this before creating a new project to avoid duplicates.",
        parameters: z.object({
          projectId: z
            .string()
            .optional()
            .describe(
              "Specific project ID to check. Leave empty for all projects.",
            ),
        }),
        execute: async ({ projectId }) => {
          if (this.projectStatusCheckedThisTurn) {
            return "You already checked project status this turn. Use the information you have to proceed — either send_directive to an existing project or create_project for new work.";
          }
          this.projectStatusCheckedThisTurn = true;
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

  private static readonly PROJECT_COOLDOWN_MS = 30_000; // 30 seconds

  private async sendDirectiveToTeamLead(
    projectId: string,
    directive: string,
  ): Promise<string> {
    const teamLead = this.teamLeads.get(projectId);
    if (!teamLead) {
      return `Error: no Team Lead found for project ${projectId}. The project may have been completed or the Team Lead may not be running.`;
    }

    this.sendMessage(teamLead.id, MessageType.Directive, directive, {
      projectId,
    });
    return `Directive sent to Team Lead ${teamLead.id} for project ${projectId}.`;
  }

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
      return `A project was just created ${Math.floor(elapsed / 1000)}s ago. Please wait ${waitSec}s before creating another, or use send_directive to add work to an existing project.`;
    }

    // Guard: require checking active projects before creating a new one
    const db = getDb();
    const activeProjects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();
    if (activeProjects.length > 0 && !this.projectStatusCheckedThisTurn) {
      return `There are ${activeProjects.length} active project(s). Call get_project_status first to see if this work fits an existing project, then use send_directive or create_project as appropriate.`;
    }

    const projectId = makeProjectId(name);

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
      onAgentStream: this._onAgentStream,
      onAgentThinking: this._onAgentThinking,
      onAgentThinkingEnd: this._onAgentThinkingEnd,
      onAgentToolCall: this._onAgentToolCall,
      onCodingAgentEvent: this._onCodingAgentEvent,
      onCodingAgentAwaitingInput: this._onCodingAgentAwaitingInput,
      onCodingAgentPermissionRequest: this._onCodingAgentPermissionRequest,
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

    // Resolve workspace path for this project
    const repoDir = this.workspace.repoPath(project.id);
    const hasRepo = existsSync(repoDir);
    const workspacePath = hasRepo ? repoDir : this.workspace.projectPath(project.id);

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
    const { messages: recentMessages } = this.bus.getHistory({
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
      `Workspace: ${workspacePath}`,
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
          const meta = settings.providerTypes.find((m) => m.type === p.type);
          const status = p.apiKeySet || !meta?.needsApiKey ? "configured" : "not configured";
          const url = p.baseUrl ? ` (${p.baseUrl})` : "";
          return `- **${p.name}** [${p.type}] (${p.id}): ${status}${url}`;
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

  /**
   * Spawn a TeamLead for a manually-created (user-initiated) project.
   * Skips LLM guards (cooldown, duplicate check) since this is user-initiated via the UI.
   */
  async spawnTeamLeadForManualProject(
    projectId: string,
    githubRepo: string,
    branch: string,
    rules: string[],
  ): Promise<void> {
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
      onAgentStream: this._onAgentStream,
      onAgentThinking: this._onAgentThinking,
      onAgentThinkingEnd: this._onAgentThinkingEnd,
      onAgentToolCall: this._onAgentToolCall,
      onCodingAgentEvent: this._onCodingAgentEvent,
      onCodingAgentAwaitingInput: this._onCodingAgentAwaitingInput,
      onCodingAgentPermissionRequest: this._onCodingAgentPermissionRequest,
    });

    this.teamLeads.set(projectId, teamLead);
    this.onAgentSpawned?.(teamLead);

    // Build GitHub-aware initial directive
    const rulesBlock = rules.length > 0
      ? `\nProject rules:\n${rules.map((r) => `- ${r}`).join("\n")}`
      : "";

    const directive =
      `You are the Team Lead for a GitHub-linked project.\n\n` +
      `Repository: ${githubRepo}\n` +
      `Target branch: ${branch}\n` +
      `Repository is already cloned to your workspace.\n\n` +
      `**PR Workflow:** Workers must create feature branches from \`${branch}\`, commit their changes, push, and open a pull request targeting \`${branch}\`.\n` +
      `Use conventional commits and reference issue numbers where applicable.${rulesBlock}\n\n` +
      `Await issue-triggered tasks or COO directives.`;

    this.sendMessage(teamLead.id, MessageType.Directive, directive, {
      projectId,
    });
  }

  /** Re-spawn TeamLeads for any projects that are still active in the DB */
  async recoverActiveProjects(): Promise<void> {
    const db = getDb();
    const activeProjects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    if (activeProjects.length === 0) {
      console.log("[COO] No active projects to recover.");
      return;
    }

    console.log(`[COO] Recovering ${activeProjects.length} active project(s)...`);
    for (const project of activeProjects) {
      try {
        await this.recoverProject(project);
        console.log(`[COO] Recovered project "${project.name}" (${project.id})`);
      } catch (err) {
        console.error(`[COO] Failed to recover project "${project.name}" (${project.id}):`, err);
      }
    }
  }

  private async recoverProject(project: {
    id: string;
    name: string;
    description: string;
    charter: string | null;
  }): Promise<void> {
    const db = getDb();

    // Ensure workspace exists (idempotent)
    this.workspace.createProject(project.id);

    // Reset orphaned in_progress tasks back to backlog (their workers are dead)
    const orphanedTasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(
        and(
          eq(schema.kanbanTasks.projectId, project.id),
          eq(schema.kanbanTasks.column, "in_progress"),
        ),
      )
      .all();

    for (const task of orphanedTasks) {
      db.update(schema.kanbanTasks)
        .set({
          column: "backlog",
          assigneeAgentId: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.kanbanTasks.id, task.id))
        .run();

      // Emit UI update for each reset task
      const updated = db
        .select()
        .from(schema.kanbanTasks)
        .where(eq(schema.kanbanTasks.id, task.id))
        .get();
      if (updated) {
        this.onKanbanTaskUpdated?.(updated as unknown as KanbanTask);
      }
    }

    if (orphanedTasks.length > 0) {
      console.log(`[COO] Reset ${orphanedTasks.length} orphaned in_progress task(s) to backlog for project ${project.id}`);
    }

    // Spawn a fresh TeamLead (same logic as createProject but skip DB insert + guards)
    const teamLead = new TeamLead({
      bus: this.bus,
      workspace: this.workspace,
      projectId: project.id,
      parentId: this.id,
      modelPackId: getRandomModelPackId(),
      onAgentSpawned: this.onAgentSpawned,
      onStatusChange: this.onStatusChange,
      onKanbanChange: (event, task) => {
        if (event === "created") this.onKanbanTaskCreated?.(task);
        else if (event === "updated") this.onKanbanTaskUpdated?.(task);
        else if (event === "deleted") this.onKanbanTaskDeleted?.(task.id, task.projectId);
      },
      onAgentStream: this._onAgentStream,
      onAgentThinking: this._onAgentThinking,
      onAgentThinkingEnd: this._onAgentThinkingEnd,
      onAgentToolCall: this._onAgentToolCall,
      onCodingAgentEvent: this._onCodingAgentEvent,
      onCodingAgentAwaitingInput: this._onCodingAgentAwaitingInput,
      onCodingAgentPermissionRequest: this._onCodingAgentPermissionRequest,
    });

    this.teamLeads.set(project.id, teamLead);
    this.onAgentSpawned?.(teamLead);

    // Build and send recovery directive
    const tasks = db
      .select()
      .from(schema.kanbanTasks)
      .where(eq(schema.kanbanTasks.projectId, project.id))
      .all();

    // Query recent agent activity for richer recovery context
    const recentActivity = db
      .select()
      .from(schema.agentActivity)
      .where(eq(schema.agentActivity.projectId, project.id))
      .all()
      .filter((a) => a.type === "response")
      .slice(-10);

    const directive = this.buildRecoveryDirective(project, tasks, recentActivity);
    this.sendMessage(teamLead.id, MessageType.Directive, directive, {
      projectId: project.id,
      projectName: project.name,
    });
  }

  private buildRecoveryDirective(
    project: { id: string; name: string; description: string; charter: string | null },
    tasks: Array<{
      id: string;
      title: string;
      description: string;
      column: string;
      blockedBy: string[];
      completionReport: string | null;
    }>,
    recentActivity?: Array<{
      agentId: string;
      content: string;
      timestamp: string;
    }>,
  ): string {
    const lines: string[] = [
      "[RECOVERY] The server was restarted. You are resuming work on an existing project.",
      "",
      `PROJECT: ${project.name}`,
      `DESCRIPTION: ${project.description}`,
    ];

    if (project.charter) {
      lines.push(`CHARTER: ${project.charter}`);
    }

    // Include GitHub context if available
    const ghRepo = getConfig(`project:${project.id}:github:repo`);
    const ghBranch = getConfig(`project:${project.id}:github:branch`);
    const ghRulesRaw = getConfig(`project:${project.id}:github:rules`);
    if (ghRepo) {
      lines.push(`GITHUB REPO: ${ghRepo}`);
      lines.push(`TARGET BRANCH: ${ghBranch ?? "main"}`);
      lines.push(`PR WORKFLOW: Workers must create feature branches from \`${ghBranch ?? "main"}\`, commit, push, and open a PR targeting \`${ghBranch ?? "main"}\`.`);
      if (ghRulesRaw) {
        try {
          const rules = JSON.parse(ghRulesRaw) as string[];
          if (rules.length > 0) {
            lines.push(`RULES: ${rules.map((r) => `- ${r}`).join("\n")}`);
          }
        } catch { /* ignore parse errors */ }
      }
    }

    const backlog = tasks.filter((t) => t.column === "backlog");
    const done = tasks.filter((t) => t.column === "done");

    if (backlog.length > 0 || done.length > 0) {
      lines.push("", "KANBAN BOARD:");

      if (backlog.length > 0) {
        lines.push(`BACKLOG (${backlog.length}):`);
        for (const t of backlog) {
          const blocked = t.blockedBy.length > 0 ? ` [blockedBy: ${t.blockedBy.join(", ")}]` : "";
          const retryCount = (t as any).retryCount ?? 0;
          const retryTag = retryCount > 0 ? ` [retry ${retryCount}/3]` : "";
          lines.push(`  - ${t.title} (${t.id})${blocked}${retryTag}`);
          if (t.description) {
            // Show full description up to 500 chars (increased from 200)
            lines.push(`    ${t.description.slice(0, 500)}${t.description.length > 500 ? "..." : ""}`);
          }
          // Include full PREVIOUS ATTEMPT FAILED blocks for context
          if (t.description && t.description.includes("PREVIOUS ATTEMPT FAILED")) {
            const failBlock = t.description.slice(t.description.lastIndexOf("--- PREVIOUS ATTEMPT FAILED ---"));
            if (failBlock.length > 500) {
              // Only add the extra block if it wasn't already covered by the description above
              lines.push(`    ${failBlock}`);
            }
          }
        }
      }

      if (done.length > 0) {
        lines.push(`DONE (${done.length}):`);
        for (const t of done) {
          lines.push(`  - ${t.title} (${t.id})`);
        }
      }
    }

    // Include completion reports from done tasks (increased from 300 to 1500 chars)
    const reports = tasks.filter((t) => t.completionReport);
    if (reports.length > 0) {
      lines.push("", "COMPLETED TASK REPORTS:");
      for (const t of reports) {
        lines.push(`  "${t.title}": ${t.completionReport!.slice(0, 1500)}${t.completionReport!.length > 1500 ? "..." : ""}`);
      }
    }

    // Include recent agent activity for approach/methodology context
    if (recentActivity && recentActivity.length > 0) {
      lines.push("", "RECENT AGENT ACTIVITY (last responses before restart):");
      for (const a of recentActivity) {
        const snippet = a.content.slice(0, 300);
        const truncated = a.content.length > 300 ? "..." : "";
        lines.push(`  [${a.timestamp}] Agent ${a.agentId.slice(0, 8)}: ${snippet}${truncated}`);
      }
    }

    lines.push(
      "",
      "INSTRUCTIONS:",
      "- Pick up unblocked backlog tasks by spawning workers.",
      "- If all tasks are done, run verification and deployment as normal.",
      "- Do NOT create duplicate tasks for work already on the board.",
    );

    return lines.join("\n");
  }

  /** Load a previous conversation by replaying persisted messages */
  loadConversation(conversationId: string, messages: BusMessage[], projectId?: string | null, charter?: string | null) {
    this.currentConversationId = conversationId;
    const ctx = this.contextManager.load(conversationId, projectId ?? null, messages, charter);
    this.activeContextId = conversationId;
    this.conversationHistory = ctx.history;
  }

  /** Start a new conversation (sets ID, resets history) */
  startNewConversation(conversationId: string, projectId?: string | null, charter?: string | null) {
    this.currentConversationId = conversationId;
    const ctx = this.contextManager.getOrCreate(conversationId, projectId ?? null, charter);
    this.activeContextId = conversationId;
    this.conversationHistory = ctx.history;
  }

  /** Override to also clear COO-specific state */
  override resetConversation() {
    super.resetConversation();
    this.currentConversationId = null;
    this.activeContextId = null;
  }

  /** Get the current conversation ID */
  getCurrentConversationId(): string | null {
    return this.currentConversationId;
  }

  getTeamLeads(): Map<string, TeamLead> {
    return this.teamLeads;
  }

  /** Destroy the TeamLead (and its workers) for a project, remove workspace, and clean up */
  destroyProject(projectId: string) {
    const teamLead = this.teamLeads.get(projectId);
    if (teamLead) {
      // Collect worker IDs before destroy clears them
      const workerIds = [...teamLead.getWorkers().keys()];
      teamLead.destroy();
      // Notify UI about destroyed agents
      for (const wid of workerIds) {
        this.onAgentDestroyed?.(wid);
      }
      this.onAgentDestroyed?.(teamLead.id);
      this.teamLeads.delete(projectId);
    }

    // Remove workspace directory
    try {
      rmSync(this.workspace.projectPath(projectId), { recursive: true, force: true });
    } catch {
      // Best-effort filesystem cleanup
    }
  }

  /** Tear down the existing TeamLead + workers and spawn a fresh one, preserving all project data */
  async recoverLiveProject(projectId: string): Promise<{ ok: boolean; error?: string }> {
    const db = getDb();
    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .get();

    if (!project) {
      return { ok: false, error: "Project not found" };
    }

    // Tear down existing TeamLead if present
    const teamLead = this.teamLeads.get(projectId);
    if (teamLead) {
      const workerIds = [...teamLead.getWorkers().keys()];
      teamLead.destroy();
      for (const wid of workerIds) {
        this.onAgentDestroyed?.(wid);
      }
      this.onAgentDestroyed?.(teamLead.id);
      this.teamLeads.delete(projectId);
    }

    // Delegate to existing recovery logic (resets orphaned tasks, spawns fresh TL, sends recovery directive)
    await this.recoverProject(project as { id: string; name: string; description: string; charter: string | null });

    console.log(`[COO] Live-recovered project "${project.name}" (${projectId})`);
    return { ok: true };
  }
}
