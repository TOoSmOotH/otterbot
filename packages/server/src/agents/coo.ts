import { nanoid } from "nanoid";
import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
  ProjectStatus,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { COO_SYSTEM_PROMPT } from "./prompts/coo.js";
import { TeamLead } from "./team-lead.js";
import { getDb, schema } from "../db/index.js";
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

export interface COODependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  onAgentSpawned?: (agent: BaseAgent) => void;
  onStream?: (token: string, messageId: string) => void;
}

export class COO extends BaseAgent {
  private teamLeads: Map<string, TeamLead> = new Map();
  private workspace: WorkspaceManager;
  private onAgentSpawned?: (agent: BaseAgent) => void;
  private onStream?: (token: string, messageId: string) => void;

  constructor(deps: COODependencies) {
    const options: AgentOptions = {
      id: "coo",
      role: AgentRole.COO,
      parentId: null,
      projectId: null,
      model: getConfig("coo_model") ?? "claude-sonnet-4-5-20250929",
      provider: getConfig("coo_provider") ?? "anthropic",
      systemPrompt: COO_SYSTEM_PROMPT,
    };
    super(options, deps.bus);
    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
    this.onStream = deps.onStream;
  }

  handleMessage(message: BusMessage): void {
    if (message.type === MessageType.Chat) {
      // CEO is talking to us
      this.handleCeoMessage(message);
    } else if (message.type === MessageType.Report) {
      // Team Lead reporting back
      this.handleTeamLeadReport(message);
    }
  }

  private async handleCeoMessage(message: BusMessage) {
    const response = await this.think(
      message.content,
      (token, messageId) => {
        if (this.onStream) {
          this.onStream(token, messageId);
        }
      },
    );

    // Send the response back through the bus (to CEO / null)
    this.sendMessage(null, MessageType.Chat, response);
  }

  private async handleTeamLeadReport(message: BusMessage) {
    // Process the Team Lead's report
    const summary = `[Report from Team Lead ${message.fromAgentId}]: ${message.content}`;
    // Add to conversation so COO remembers context
    this.conversationHistory.push({ role: "user", content: summary });
    // COO may decide to relay to CEO or take action
    const response = await this.think(
      summary,
      (token, messageId) => {
        if (this.onStream) {
          this.onStream(token, messageId);
        }
      },
    );

    // If the report is significant, relay to CEO
    if (response.trim()) {
      this.sendMessage(null, MessageType.Chat, response);
    }
  }

  protected getTools(): Record<string, unknown> {
    return {
      create_project: tool({
        description:
          "Create a new project and spawn a Team Lead to manage it. Use this when the CEO gives you a new goal or task that requires work.",
        parameters: z.object({
          name: z
            .string()
            .describe("Short project name"),
          description: z
            .string()
            .describe("Detailed description of what needs to be done"),
          directive: z
            .string()
            .describe(
              "The directive to give the Team Lead — what they need to accomplish",
            ),
        }),
        execute: async ({ name, description, directive }) => {
          return this.createProject(name, description, directive);
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

  private async createProject(
    name: string,
    description: string,
    directive: string,
  ): Promise<string> {
    const projectId = nanoid();
    const db = getDb();

    // Create project record
    db.insert(schema.projects)
      .values({
        id: projectId,
        name,
        description,
        status: ProjectStatus.Active,
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
      onAgentSpawned: this.onAgentSpawned,
    });

    this.teamLeads.set(projectId, teamLead);

    if (this.onAgentSpawned) {
      this.onAgentSpawned(teamLead);
    }

    // Send directive to Team Lead
    this.sendMessage(teamLead.id, MessageType.Directive, directive, {
      projectId,
      projectName: name,
    });

    return `Project "${name}" created (${projectId}). Team Lead ${teamLead.id} assigned and directive sent.`;
  }

  private getProjectStatus(projectId?: string): string {
    const db = getDb();

    if (projectId) {
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId))
        .get();
      if (!project) return `Project ${projectId} not found.`;

      const agents = db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.projectId, projectId))
        .all();

      return `Project "${project.name}" (${project.status}): ${agents.length} agents active.`;
    }

    const projects = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.status, "active"))
      .all();

    if (projects.length === 0) return "No active projects.";

    return projects
      .map((p) => `- "${p.name}" (${p.id}): ${p.status}`)
      .join("\n");
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

  getTeamLeads(): Map<string, TeamLead> {
    return this.teamLeads;
  }
}
