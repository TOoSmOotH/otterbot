import { tool } from "ai";
import { z } from "zod";
import {
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
  type ModuleAgentConfig,
  type ModuleToolDefinition,
  type ModuleContext,
} from "@otterbot/shared";
import { BaseAgent, type AgentOptions } from "./agent.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { ModuleKnowledgeStore } from "../modules/module-knowledge-store.js";
import { getConfig } from "../auth/auth.js";

export interface ModuleAgentDeps {
  moduleId: string;
  agentConfig: ModuleAgentConfig;
  knowledgeStore: ModuleKnowledgeStore;
  moduleContext: ModuleContext;
  moduleTools?: ModuleToolDefinition[];
  bus: MessageBus;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
  onStream?: (agentId: string, token: string, messageId: string) => void;
  onThinking?: (agentId: string, token: string, messageId: string) => void;
  onThinkingEnd?: (agentId: string, messageId: string) => void;
}

export class ModuleAgent extends BaseAgent {
  readonly moduleId: string;
  private knowledgeStore: ModuleKnowledgeStore;
  private moduleContext: ModuleContext;
  private moduleToolDefs: ModuleToolDefinition[];
  private onStream?: (agentId: string, token: string, messageId: string) => void;
  private onThinking?: (agentId: string, token: string, messageId: string) => void;
  private onThinkingEnd?: (agentId: string, messageId: string) => void;

  constructor(deps: ModuleAgentDeps) {
    const moduleId = deps.moduleId;

    // Read config overrides, falling back to module defaults
    const agentName = getConfig(`module:${moduleId}:agent_name`) ?? deps.agentConfig.defaultName;
    const systemPrompt = getConfig(`module:${moduleId}:agent_prompt`) ?? deps.agentConfig.defaultPrompt;
    const model = getConfig(`module:${moduleId}:agent_model`)
      ?? deps.agentConfig.defaultModel
      ?? getConfig("worker_model")
      ?? getConfig("coo_model")
      ?? "claude-sonnet-4-5-20250929";
    const provider = getConfig(`module:${moduleId}:agent_provider`)
      ?? deps.agentConfig.defaultProvider
      ?? getConfig("worker_provider")
      ?? getConfig("coo_provider")
      ?? "anthropic";

    const options: AgentOptions = {
      id: `module-agent-${moduleId}`,
      name: agentName,
      role: AgentRole.ModuleAgent,
      parentId: "coo",
      projectId: null,
      model,
      provider,
      systemPrompt,
      onStatusChange: deps.onStatusChange,
    };

    super(options, deps.bus);
    this.llmConfig.maxSteps = 8;
    this.moduleId = moduleId;
    this.knowledgeStore = deps.knowledgeStore;
    this.moduleContext = deps.moduleContext;
    this.moduleToolDefs = deps.moduleTools ?? [];
    this.onStream = deps.onStream;
    this.onThinking = deps.onThinking;
    this.onThinkingEnd = deps.onThinkingEnd;
  }

  protected getTools(): Record<string, unknown> {
    const tools: Record<string, unknown> = {};

    // knowledge_search — searches this module's knowledge store
    tools.knowledge_search = tool({
      description:
        "Search this module's knowledge store for relevant documents. " +
        "Uses hybrid full-text + vector search for best results.",
      parameters: z.object({
        query: z.string().describe("The search query"),
        limit: z.number().optional().describe("Max results to return (default 10)"),
      }),
      execute: async ({ query, limit }) => {
        const results = await this.knowledgeStore.search(query, limit ?? 10);
        if (results.length === 0) {
          return "No results found.";
        }
        return results
          .map((doc) => {
            const meta = doc.metadata;
            const url = meta?.url ? ` (${meta.url})` : "";
            return `---\n${doc.content}${url}\n`;
          })
          .join("\n");
      },
    });

    // Expose any custom tools the module defines
    for (const moduleTool of this.moduleToolDefs) {
      const shape: Record<string, z.ZodTypeAny> = {};
      const params = moduleTool.parameters as Record<string, { type?: string; description?: string; required?: boolean }>;
      for (const [key, param] of Object.entries(params)) {
        let fieldSchema: z.ZodTypeAny;
        const desc = param.description ?? "";
        switch (param.type) {
          case "number":
            fieldSchema = z.number().describe(desc);
            break;
          case "boolean":
            fieldSchema = z.boolean().describe(desc);
            break;
          default:
            fieldSchema = z.string().describe(desc);
        }
        shape[key] = param.required ? fieldSchema : fieldSchema.optional();
      }

      tools[moduleTool.name] = tool({
        description: moduleTool.description,
        parameters: z.object(shape),
        execute: async (args: Record<string, unknown>) => {
          return moduleTool.execute(args, this.moduleContext);
        },
      });
    }

    return tools;
  }

  async handleMessage(message: BusMessage): Promise<void> {
    if (message.type === MessageType.Directive) {
      await this.handleDirective(message);
    } else if (message.type === MessageType.Chat) {
      // Also handle chat messages (from scheduled tasks or direct queries)
      await this.handleDirective(message);
    }
  }

  private async handleDirective(message: BusMessage) {
    const { text, thinking } = await this.think(
      message.content,
      (token, messageId) => {
        this.onStream?.(this.id, token, messageId);
      },
      (token, messageId) => {
        this.onThinking?.(this.id, token, messageId);
      },
      (messageId) => {
        this.onThinkingEnd?.(this.id, messageId);
      },
    );

    // If has correlationId, reply with it so request() resolves
    if (message.correlationId && message.fromAgentId) {
      this.sendMessage(
        message.fromAgentId,
        MessageType.Report,
        text,
        thinking ? { thinking, moduleId: this.moduleId } : { moduleId: this.moduleId },
        undefined,
        message.correlationId,
      );
    } else if (message.fromAgentId) {
      this.sendMessage(
        message.fromAgentId,
        MessageType.Report,
        text,
        thinking ? { thinking, moduleId: this.moduleId } : { moduleId: this.moduleId },
      );
    }
  }

  /** Re-read model/provider from config before each think */
  protected refreshLlmConfig(): void {
    const model = getConfig(`module:${this.moduleId}:agent_model`)
      ?? getConfig("worker_model")
      ?? getConfig("coo_model");
    const provider = getConfig(`module:${this.moduleId}:agent_provider`)
      ?? getConfig("worker_provider")
      ?? getConfig("coo_provider");

    if (model) this.llmConfig.model = model;
    if (provider) this.llmConfig.provider = provider;
  }
}
