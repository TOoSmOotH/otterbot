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
import { RetryError } from "ai";
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
  onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
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
  protected onAgentStream?: (agentId: string, token: string, messageId: string) => void;
  protected onAgentThinking?: (agentId: string, token: string, messageId: string) => void;
  protected onAgentThinkingEnd?: (agentId: string, messageId: string) => void;
  protected onAgentToolCall?: (agentId: string, toolName: string, args: Record<string, unknown>) => void;

  private messageQueue: BusMessage[] = [];
  private processing = false;

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
    this.onAgentStream = options.onAgentStream;
    this.onAgentThinking = options.onAgentThinking;
    this.onAgentThinkingEnd = options.onAgentThinkingEnd;
    this.onAgentToolCall = options.onAgentToolCall;
    this.llmConfig = {
      provider: options.provider,
      model: options.model,
      baseUrl: options.baseUrl,
      temperature: options.temperature,
    };

    this.conversationHistory = [
      { role: "system", content: this.systemPrompt },
    ];

    // Register with the bus — queue messages to serialize processing
    this.bus.subscribe(this.id, (msg) => this.enqueue(msg));

    // Persist to database
    this.persistAgent(options);
  }

  /** Handle an incoming message from the bus */
  abstract handleMessage(message: BusMessage): Promise<void>;

  /** Enqueue a message for serialized processing */
  private enqueue(message: BusMessage): void {
    this.messageQueue.push(message);
    if (!this.processing) {
      void this.drainQueue();
    }
  }

  /** Process queued messages one at a time */
  private async drainQueue(): Promise<void> {
    this.processing = true;
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      try {
        await this.handleMessage(msg);
      } catch (err) {
        console.error(`[Agent ${this.id}] Error handling message:`, err);
      }
    }
    this.processing = false;
  }

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
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean }> {
    this.conversationHistory.push({ role: "user", content: userMessage });
    this.setStatus(AgentStatus.Thinking);
    console.log(`[Agent ${this.id}] think() — provider=${this.llmConfig.provider} model=${this.llmConfig.model}`);

    try {
      const tools = this.getTools();
      const hasTools = Object.keys(tools).length > 0;

      const { text, thinking, hadToolCalls } = await this.runStream(
        hasTools ? tools : undefined,
        onToken,
        onReasoning,
        onReasoningEnd,
      );

      // If tools were sent and the stream produced NO text AND NO tool calls,
      // the provider likely doesn't support function calling — retry without tools.
      // IMPORTANT: If tool calls were made (hadToolCalls), do NOT retry — the SDK
      // already executed the tools via their `execute` callbacks during the stream.
      if (hasTools && !text && !hadToolCalls) {
        console.warn(`[Agent ${this.id}] Empty response with tools and no tool calls — retrying without tools`);
        const retry = await this.runStream(
          undefined,
          onToken,
          onReasoning,
          onReasoningEnd,
        );
        this.conversationHistory.push({
          role: "assistant",
          content: retry.text,
        });
        this.setStatus(AgentStatus.Idle);
        return { text: retry.text, thinking: retry.thinking, hadToolCalls: false };
      }

      // If tools were called but final text is empty, synthesize a placeholder
      // so callers have something to work with.
      const finalText = text || (hadToolCalls ? "(tool calls executed)" : "");

      this.conversationHistory.push({
        role: "assistant",
        content: finalText,
      });
      this.setStatus(AgentStatus.Idle);
      return { text: finalText, thinking, hadToolCalls };
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      if (error instanceof RetryError) {
        console.error(`[Agent ${this.id}] Rate limited by provider — retries exhausted`);
        return { text: "Error: Rate limited by provider — retries exhausted", thinking: undefined, hadToolCalls: false };
      }
      const errMsg =
        error instanceof Error ? error.message : "Unknown LLM error";
      console.error(`Agent ${this.id} LLM error:`, errMsg);
      return { text: `Error: ${errMsg}`, thinking: undefined, hadToolCalls: false };
    }
  }

  /** Execute a tool call — subclasses override to add tools */
  protected async executeTool(
    _name: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    return null;
  }

  /**
   * Run a single LLM stream and collect the response.
   * Includes a 30-second timeout for the first chunk and a 120-second
   * per-chunk timeout for subsequent chunks to prevent infinite hangs.
   */
  private async runStream(
    tools: Record<string, unknown> | undefined,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean }> {
    const result = await stream(
      this.llmConfig,
      this.conversationHistory,
      tools,
    );

    const messageId = nanoid();
    let fullResponse = "";
    let reasoning = "";
    let wasReasoning = false;
    let hadToolCalls = false;

    // Race the first chunk against a 30s timeout to detect hanging providers
    const iterator = result.fullStream[Symbol.asyncIterator]();
    const FIRST_CHUNK_TIMEOUT = 30_000;
    const CHUNK_TIMEOUT = 120_000; // 2 min per-chunk timeout for slow models

    const nextWithTimeout = (timeoutMs: number) =>
      Promise.race([
        iterator.next(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs),
        ),
      ]);

    const first = await nextWithTimeout(FIRST_CHUNK_TIMEOUT);

    if (first.done) {
      // Timed out or empty stream
      console.warn(`[Agent ${this.id}] Stream produced no data within ${FIRST_CHUNK_TIMEOUT / 1000}s (tools=${!!tools})`);
      return { text: "", thinking: undefined, hadToolCalls: false };
    }

    // Process first part
    const processPart = (part: any) => {
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
        hadToolCalls = true;
        console.log(`[Agent ${this.id}] Tool call: ${part.toolName}(${JSON.stringify(part.args ?? {}).slice(0, 200)})`);
        this.onAgentToolCall?.(this.id, part.toolName, (part.args ?? {}) as Record<string, unknown>);
        this.persistActivity("tool_call", JSON.stringify(part.args ?? {}), {
          toolName: part.toolName,
          args: part.args ?? {},
        }, messageId);
      } else if (part.type === "tool-result") {
        const resultStr = typeof part.result === "string" ? part.result : JSON.stringify(part.result ?? "");
        console.log(`[Agent ${this.id}] Tool result (${part.toolName}): ${resultStr.slice(0, 300)}`);
      }
    };

    processPart(first.value);

    // Process remaining parts with per-chunk timeout
    while (true) {
      const next = await nextWithTimeout(CHUNK_TIMEOUT);
      if (next.done) break;
      processPart(next.value);
    }

    if (wasReasoning) {
      onReasoningEnd?.(messageId);
    }

    // Note: tool execution is handled by the Vercel AI SDK via `execute`
    // callbacks during the stream above — no need to call executeTool here.

    // Persist accumulated thinking and response
    if (reasoning) {
      this.persistActivity("thinking", reasoning, {}, messageId);
    }
    if (fullResponse) {
      this.persistActivity("response", fullResponse, {}, messageId);
    }

    console.log(`[Agent ${this.id}] runStream complete — text=${fullResponse.length} chars, thinking=${reasoning.length} chars, toolCalls=${hadToolCalls}`);
    return { text: fullResponse, thinking: reasoning || undefined, hadToolCalls };
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

  /** Persist an activity record to the database */
  private persistActivity(
    type: "thinking" | "response" | "tool_call",
    content: string,
    metadata: Record<string, unknown>,
    messageId?: string,
  ) {
    try {
      const db = getDb();
      db.insert(schema.agentActivity)
        .values({
          id: nanoid(),
          agentId: this.id,
          type,
          content,
          metadata,
          projectId: this.projectId,
          messageId: messageId ?? null,
          timestamp: new Date().toISOString(),
        })
        .run();
    } catch (err) {
      console.error(`[Agent ${this.id}] Failed to persist activity:`, err);
    }
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
