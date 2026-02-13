import { nanoid } from "nanoid";
import {
  type Agent as AgentData,
  type GearConfig,
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@smoothbot/shared";
import { getDb, schema } from "../db/index.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { ChatMessage, LLMConfig } from "../llm/adapter.js";
import { stream } from "../llm/adapter.js";
import { eq } from "drizzle-orm";

export interface AgentOptions {
  id?: string;
  role: AgentRole;
  parentId: string | null;
  projectId: string | null;
  registryEntryId?: string | null;
  modelPackId?: string | null;
  gearConfig?: GearConfig | null;
  model: string;
  provider: string;
  baseUrl?: string;
  temperature?: number;
  systemPrompt: string;
  workspacePath?: string | null;
  onStatusChange?: (agentId: string, status: AgentStatus) => void;
}

export abstract class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  readonly parentId: string | null;
  readonly projectId: string | null;
  readonly registryEntryId: string | null;
  readonly modelPackId: string | null;
  readonly gearConfig: GearConfig | null;
  protected bus: MessageBus;
  protected status: AgentStatus = AgentStatus.Idle;
  protected conversationHistory: ChatMessage[] = [];
  protected llmConfig: LLMConfig;
  protected systemPrompt: string;
  protected onStatusChange?: (agentId: string, status: AgentStatus) => void;

  constructor(options: AgentOptions, bus: MessageBus) {
    this.id = options.id ?? nanoid();
    this.role = options.role;
    this.parentId = options.parentId;
    this.projectId = options.projectId;
    this.registryEntryId = options.registryEntryId ?? null;
    this.modelPackId = options.modelPackId ?? null;
    this.gearConfig = options.gearConfig ?? null;
    this.bus = bus;
    this.systemPrompt = options.systemPrompt;

    this.onStatusChange = options.onStatusChange;
    this.llmConfig = {
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      temperature: options.temperature,
    };

    this.conversationHistory = [
      { role: "system", content: this.systemPrompt },
    ];

    // Register with the bus
    this.bus.subscribe(this.id, (msg) => this.handleMessage(msg));

    // Persist to database
    this.persistAgent(options);
  }

  /** Handle an incoming message from the bus */
  abstract handleMessage(message: BusMessage): Promise<void>;

  /** Get tools available to this agent for tool calling */
  protected getTools(): Record<string, unknown> {
    return {};
  }

  /** Update agent status and broadcast */
  protected setStatus(status: AgentStatus) {
    this.status = status;
    const db = getDb();
    db.update(schema.agents)
      .set({ status })
      .where(eq(schema.agents.id, this.id))
      .run();
    this.onStatusChange?.(this.id, status);
  }

  /** Get a human-readable status summary (override in subclasses) */
  getStatusSummary(): string {
    return `${this.role} [${this.status}]`;
  }

  /** Send a response via the bus */
  protected sendMessage(
    toAgentId: string | null,
    type: MessageType,
    content: string,
    metadata?: Record<string, unknown>,
    conversationId?: string,
    correlationId?: string,
  ): BusMessage {
    return this.bus.send({
      fromAgentId: this.id,
      toAgentId,
      type,
      content,
      metadata,
      projectId: this.projectId ?? undefined,
      conversationId,
      correlationId,
    });
  }

  /** Run LLM inference with the current conversation and stream the response */
  protected async think(
    userMessage: string,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined }> {
    this.conversationHistory.push({ role: "user", content: userMessage });
    this.setStatus(AgentStatus.Thinking);

    try {
      const tools = this.getTools();
      const hasTools = Object.keys(tools).length > 0;
      console.log(`[Agent ${this.id}] Calling stream() — hasTools=${hasTools}, history=${this.conversationHistory.length} msgs`);
      const result = await stream(
        this.llmConfig,
        this.conversationHistory,
        hasTools ? tools : undefined,
      );
      console.log(`[Agent ${this.id}] stream() returned, iterating fullStream...`);

      const messageId = nanoid();
      let fullResponse = "";
      let reasoning = "";
      let wasReasoning = false;

      let partCount = 0;
      for await (const part of result.fullStream) {
        if (partCount === 0) {
          console.log(`[Agent ${this.id}] First stream part: type=${part.type}`);
        }
        partCount++;
        if (part.type === "reasoning") {
          reasoning += part.textDelta;
          wasReasoning = true;
          onReasoning?.(part.textDelta, messageId);
        } else if (part.type === "text-delta") {
          if (wasReasoning) {
            wasReasoning = false;
            onReasoningEnd?.(messageId);
          }
          fullResponse += part.textDelta;
          onToken?.(part.textDelta, messageId);
        } else if (part.type === "tool-call") {
          console.log(`[Agent ${this.id}] Tool call: ${(part as any).toolName}`);
        } else if (part.type === "error") {
          console.error(`[Agent ${this.id}] Stream error part:`, (part as any).error);
        }
      }
      console.log(`[Agent ${this.id}] Stream finished — ${partCount} parts, ${fullResponse.length} chars`);

      // If reasoning ended but no text-delta followed, still fire end
      if (wasReasoning) {
        onReasoningEnd?.(messageId);
      }

      // Check for tool calls (await the promise)
      const toolCalls = await result.toolCalls;
      if (toolCalls && toolCalls.length > 0) {
        this.setStatus(AgentStatus.Acting);
        for (const toolCall of toolCalls) {
          await this.executeTool(
            toolCall.toolName,
            toolCall.args as Record<string, unknown>,
          );
        }
      }

      this.conversationHistory.push({
        role: "assistant",
        content: fullResponse,
      });
      this.setStatus(AgentStatus.Idle);
      return { text: fullResponse, thinking: reasoning || undefined };
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      const errMsg =
        error instanceof Error ? error.message : "Unknown LLM error";
      console.error(`Agent ${this.id} LLM error:`, errMsg);
      return { text: `Error: ${errMsg}`, thinking: undefined };
    }
  }

  /** Execute a tool call — subclasses override to add tools */
  protected async executeTool(
    _name: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    return null;
  }

  /** Get the agent's data representation */
  toData(): AgentData {
    return {
      id: this.id,
      registryEntryId: this.registryEntryId,
      role: this.role,
      parentId: this.parentId,
      status: this.status,
      model: this.llmConfig.model,
      provider: this.llmConfig.provider,
      baseUrl: this.llmConfig.baseUrl,
      temperature: this.llmConfig.temperature,
      systemPrompt: this.systemPrompt,
      modelPackId: this.modelPackId,
      gearConfig: this.gearConfig,
      projectId: this.projectId,
      workspacePath: null,
      createdAt: new Date().toISOString(),
    };
  }

  /** Reset conversation history to just the system prompt */
  resetConversation() {
    this.conversationHistory = [
      { role: "system", content: this.systemPrompt },
    ];
  }

  /** Clean up this agent */
  destroy() {
    this.bus.unsubscribe(this.id);
    this.status = AgentStatus.Done;
    const db = getDb();
    db.update(schema.agents)
      .set({ status: "done" })
      .where(eq(schema.agents.id, this.id))
      .run();
    this.onStatusChange?.(this.id, AgentStatus.Done);
  }

  private persistAgent(options: AgentOptions) {
    const db = getDb();
    const values = {
      id: this.id,
      registryEntryId: this.registryEntryId,
      role: this.role,
      parentId: this.parentId,
      status: this.status,
      model: this.llmConfig.model,
      provider: this.llmConfig.provider,
      baseUrl: this.llmConfig.baseUrl,
      systemPrompt: this.systemPrompt,
      modelPackId: this.modelPackId,
      gearConfig: this.gearConfig ? JSON.stringify(this.gearConfig) : null,
      projectId: this.projectId,
      workspacePath: options.workspacePath ?? null,
      createdAt: new Date().toISOString(),
    };
    db.insert(schema.agents)
      .values(values)
      .onConflictDoUpdate({
        target: schema.agents.id,
        set: {
          status: values.status,
          model: values.model,
          provider: values.provider,
          baseUrl: values.baseUrl,
          systemPrompt: values.systemPrompt,
        },
      })
      .run();
  }
}
