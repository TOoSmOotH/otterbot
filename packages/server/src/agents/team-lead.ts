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
import { Registry } from "../registry/registry.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { WorkspaceManager } from "../workspace/workspace.js";
import { eq } from "drizzle-orm";
import { getConfig } from "../auth/auth.js";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { TEAM_LEAD_PROMPT } from "./prompts/team-lead.js";

export interface TeamLeadDependencies {
  bus: MessageBus;
  workspace: WorkspaceManager;
  projectId: string;
  parentId: string;
  onAgentSpawned?: (agent: BaseAgent) => void;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
}

export class TeamLead extends BaseAgent {
  private workers: Map<string, Worker> = new Map();
  private workspace: WorkspaceManager;
  private onAgentSpawned?: (agent: BaseAgent) => void;

  constructor(deps: TeamLeadDependencies) {
    const registry = new Registry();
    const tlEntry = registry.get("builtin-team-lead");
    const options: AgentOptions = {
      role: AgentRole.TeamLead,
      parentId: deps.parentId,
      projectId: deps.projectId,
      model:
        getConfig("team_lead_model") ??
        getConfig("coo_model") ??
        "claude-sonnet-4-5-20250929",
      provider:
        getConfig("team_lead_provider") ??
        getConfig("coo_provider") ??
        "anthropic",
      systemPrompt: tlEntry?.systemPrompt ?? TEAM_LEAD_PROMPT,
      onStatusChange: deps.onStatusChange,
    };
    super(options, deps.bus);
    this.workspace = deps.workspace;
    this.onAgentSpawned = deps.onAgentSpawned;
  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Directive) {
      await this.handleDirective(message);
    } else if (message.type === MessageType.Report) {
      await this.handleWorkerReport(message);
    } else if (message.type === MessageType.StatusRequest) {
      await this.handleStatusRequest(message);
    }
  }

  private async handleDirective(message: BusMessage) {
    const { text } = await this.think(message.content);

    // Report plan/progress back to COO
    if (this.parentId) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }
  }

  private async handleWorkerReport(message: BusMessage) {
    const summary = `[Worker ${message.fromAgentId} report]: ${message.content}`;
    const { text } = await this.think(summary);

    // Relay significant updates to COO
    if (this.parentId && text.trim()) {
      this.sendMessage(this.parentId, MessageType.Report, text);
    }
  }

  private async handleStatusRequest(message: BusMessage) {
    const workerStatuses: string[] = [];

    // Query each worker for its status (5s timeout per worker)
    const workerEntries = Array.from(this.workers.entries());
    const results = await Promise.all(
      workerEntries.map(async ([id, _worker]) => {
        const reply = await this.bus.request(
          {
            fromAgentId: this.id,
            toAgentId: id,
            type: MessageType.StatusRequest,
            content: "status",
            projectId: this.projectId ?? undefined,
          },
          5_000,
        );
        return reply ? reply.content : `Worker ${id}: no response (may be busy)`;
      }),
    );

    workerStatuses.push(...results);

    const summary = [
      this.getStatusSummary(),
      `Workers (${this.workers.size}):`,
      ...workerStatuses.map((s) => `  - ${s}`),
    ].join("\n");

    this.sendMessage(
      message.fromAgentId,
      MessageType.StatusResponse,
      summary,
      undefined,
      undefined,
      message.correlationId,
    );
  }

  override getStatusSummary(): string {
    return `TeamLead ${this.id} [${this.status}] — ${this.workers.size} worker(s)`;
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
            return "No search provider configured. Ask the COO to set up a search provider.";
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
      // Only return worker-role entries (not COO or Team Lead)
      if (entry.role !== "worker") return false;
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
      toolNames: (entry.tools as string[]) ?? [],
      onStatusChange: this.onStatusChange,
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
