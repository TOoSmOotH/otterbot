import { nanoid } from "nanoid";
import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@smoothbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import { Worker } from "./worker.js";
import { getDb, schema } from "../db/index.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq } from "drizzle-orm";

const TEAM_LEAD_PROMPT = `You are a Team Lead in Smoothbot. You report to the COO and manage a team of worker agents.

## Your Responsibilities
- Receive directives from the COO and break them into actionable tasks
- Query the agent registry to find workers with the right capabilities
- Spawn workers and assign them specific tasks
- Monitor worker progress and handle issues
- Report results back to the COO

## How You Work
1. When you receive a directive, analyze what capabilities are needed
2. Query the registry for suitable agent templates
3. Spawn workers from appropriate templates
4. Give each worker a clear, specific task
5. Collect results and report back to the COO

## Rules
- Break large tasks into smaller pieces — each worker gets one focused task
- Use the right specialist for each job (coder for code, researcher for research, etc.)
- Report progress to the COO — don't go silent
- If a worker fails, assess whether to retry or report the issue`;

export interface TeamLeadDependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  projectId: string;
  parentId: string;
  onAgentSpawned?: (agent: BaseAgent) => void;
}

export class TeamLead extends BaseAgent {
  private workers: Map<string, Worker> = new Map();
  private workspace: WorkspaceManager;
  private onAgentSpawned?: (agent: BaseAgent) => void;

  constructor(deps: TeamLeadDependencies) {
    const options: AgentOptions = {
      role: AgentRole.TeamLead,
      parentId: deps.parentId,
      projectId: deps.projectId,
      model: process.env.TEAM_LEAD_MODEL ?? "claude-sonnet-4-5-20250929",
      provider: process.env.TEAM_LEAD_PROVIDER ?? "anthropic",
      systemPrompt: TEAM_LEAD_PROMPT,
    };
    super(options, deps.bus);
    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
  }

  handleMessage(message: BusMessage): void {
    if (message.type === MessageType.Directive) {
      this.handleDirective(message);
    } else if (message.type === MessageType.Report) {
      this.handleWorkerReport(message);
    }
  }

  private async handleDirective(message: BusMessage) {
    const response = await this.think(message.content);

    // Report plan/progress back to COO
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, response);
    }
  }

  private async handleWorkerReport(message: BusMessage) {
    const summary = `[Worker ${message.fromAgentId} report]: ${message.content}`;
    const response = await this.think(summary);

    // Relay significant updates to COO
    if (this.parentId && response.trim()) {
      this.sendMessage(this.parentId, MessageType.Report, response);
    }
  }

  protected getTools(): Record<string, unknown> {
    return {
      search_registry: tool({
        description:
          "Search the agent registry for workers with specific capabilities.",
        parameters: z.object({
          capability: z
            .string()
            .describe(
              "The capability to search for (e.g., 'code', 'research', 'testing')",
            ),
        }),
        execute: async ({ capability }) => {
          return this.searchRegistry(capability);
        },
      }),
      spawn_worker: tool({
        description:
          "Spawn a worker agent from a registry template and assign it a task.",
        parameters: z.object({
          registryEntryId: z
            .string()
            .describe("The ID of the registry entry to use as a template"),
          task: z
            .string()
            .describe("The specific task to assign to the worker"),
        }),
        execute: async ({ registryEntryId, task }) => {
          return this.spawnWorker(registryEntryId, task);
        },
      }),
      report_to_coo: tool({
        description: "Send a progress report or result to the COO.",
        parameters: z.object({
          content: z
            .string()
            .describe("The report content to send to the COO"),
        }),
        execute: async ({ content }) => {
          if (this.parentId) {
            this.sendMessage(this.parentId, MessageType.Report, content);
          }
          return "Report sent to COO.";
        },
      }),
    };
  }

  private searchRegistry(capability: string): string {
    const db = getDb();
    const allEntries = db.select().from(schema.registryEntries).all();

    const matches = allEntries.filter((entry) => {
      const caps = entry.capabilities as string[];
      return caps.some((c) =>
        c.toLowerCase().includes(capability.toLowerCase()),
      );
    });

    if (matches.length === 0) {
      return `No agents found with capability "${capability}".`;
    }

    return matches
      .map(
        (e) =>
          `- ${e.name} (${e.id}): ${e.description} [capabilities: ${(e.capabilities as string[]).join(", ")}]`,
      )
      .join("\n");
  }

  private async spawnWorker(
    registryEntryId: string,
    task: string,
  ): Promise<string> {
    const db = getDb();
    const entry = db
      .select()
      .from(schema.registryEntries)
      .where(eq(schema.registryEntries.id, registryEntryId))
      .get();

    if (!entry) {
      return `Registry entry ${registryEntryId} not found.`;
    }

    // Create worker workspace
    const workspacePath = this.projectId
      ? this.workspace.createAgentWorkspace(
          this.projectId,
          nanoid(),
        )
      : null;

    const worker = new Worker({
      bus: this.bus,
      projectId: this.projectId,
      parentId: this.id,
      registryEntryId: entry.id,
      model: entry.defaultModel,
      provider: entry.defaultProvider,
      systemPrompt: entry.systemPrompt,
      workspacePath,
    });

    this.workers.set(worker.id, worker);

    if (this.onAgentSpawned) {
      this.onAgentSpawned(worker);
    }

    // Send the task to the worker
    this.sendMessage(worker.id, MessageType.Directive, task, {
      registryEntryName: entry.name,
    });

    return `Spawned ${entry.name} worker (${worker.id}) and assigned task.`;
  }

  getWorkers(): Map<string, Worker> {
    return this.workers;
  }
}
