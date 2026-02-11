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
      model: process.env.COO_MODEL ?? "claude-sonnet-4-5-20250929",
      provider: process.env.COO_PROVIDER ?? "anthropic",
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

  getTeamLeads(): Map<string, TeamLead> {
    return this.teamLeads;
  }
}
