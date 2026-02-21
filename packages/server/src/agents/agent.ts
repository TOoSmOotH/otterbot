import { nanoid } from "nanoid";
import {
  type Agent as AgentData,
  type GearConfig,
  AgentRole,
  AgentStatus,
  MessageType,
  type BusMessage,
} from "@otterbot/shared";
import { getDb, schema } from "../db/index.js";
import type { MessageBus } from "../bus/message-bus.js";
import type { ChatMessage, LLMConfig } from "../llm/adapter.js";
import { stream, resolveProviderCredentials } from "../llm/adapter.js";
import { RetryError } from "ai";
import {
  containsKimiToolMarkup,
  findToolMarkupStart,
  formatToolsForPrompt,
  parseKimiToolCalls,
  usesTextToolCalling,
} from "../llm/kimi-tool-parser.js";
import { eq } from "drizzle-orm";
import { calculateCost } from "../settings/model-pricing.js";
import { getCircuitBreaker, isProviderAvailable } from "../llm/circuit-breaker.js";
import { debug } from "../utils/debug.js";

export interface AgentOptions {
  id?: string;
  name?: string | null;
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
  readonly name: string | null;
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

  /** Set by tool guards to signal that the current think() stream should abort after the current step */
  protected _shouldAbortThink = false;

  /** External abort signal — set by Worker.abort() to cancel running think()/runStream() */
  protected _externalAbortController: AbortController | null = null;

  private messageQueue: BusMessage[] = [];
  private processing = false;

  constructor(options: AgentOptions, bus: MessageBus) {
    this.id = options.id ?? nanoid();
    this.name = options.name ?? null;
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
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean; isError?: boolean; timedOut?: boolean }> {
    // Reset abort flag at the start of each think cycle
    this._shouldAbortThink = false;

    // Circuit breaker: reject immediately if provider is known to be down
    if (!isProviderAvailable(this.llmConfig.provider)) {
      const breaker = getCircuitBreaker(this.llmConfig.provider);
      const cooldown = Math.ceil(breaker.remainingCooldownMs / 1000);
      console.warn(`[Agent ${this.id}] Circuit breaker OPEN for provider ${this.llmConfig.provider} — rejecting (${cooldown}s remaining)`);
      return {
        text: `Error: LLM provider "${this.llmConfig.provider}" temporarily unavailable (circuit breaker open, ${cooldown}s cooldown remaining). Retries will resume automatically.`,
        thinking: undefined,
        hadToolCalls: false,
        isError: true,
      };
    }

    this.conversationHistory.push({ role: "user", content: userMessage });
    this.setStatus(AgentStatus.Thinking);
    console.log(`[Agent ${this.id}] think() — provider=${this.llmConfig.provider} model=${this.llmConfig.model}`);

    try {
      const tools = this.getTools();
      const hasTools = Object.keys(tools).length > 0;
      const textToolMode = hasTools && usesTextToolCalling(this.llmConfig.model);

      // For models that use text-based tool calling (e.g. Kimi K2.5), skip the
      // SDK-tools call entirely — it always returns empty. Go straight to text injection.
      let text: string;
      let thinking: string | undefined;
      let hadToolCalls: boolean;
      let timedOut: boolean | undefined;

      if (textToolMode) {
        text = "";
        thinking = undefined;
        hadToolCalls = false;
        timedOut = false;
        console.log(`[Agent ${this.id}] Text-tool-calling model detected — skipping SDK tools`);
      } else {
        ({ text, thinking, hadToolCalls, timedOut } = await this.runStream(
          hasTools ? tools : undefined,
          onToken,
          onReasoning,
          onReasoningEnd,
        ));
        getCircuitBreaker(this.llmConfig.provider).recordSuccess();
      }

      // If tools were available but the stream produced NO text AND NO tool calls,
      // the provider likely doesn't support function calling — use text injection.
      // IMPORTANT: If tool calls were made (hadToolCalls), do NOT retry — the SDK
      // already executed the tools via their `execute` callbacks during the stream.
      if (hasTools && !text && !hadToolCalls) {
        if (!textToolMode) {
          console.warn(`[Agent ${this.id}] Empty response with tools and no tool calls — retrying without tools`);
        }

        // Inject tool descriptions as a system message so models that don't
        // support structured function calling (e.g. Kimi K2.5) can still
        // see what tools are available and emit proprietary markup.
        const toolPrompt = formatToolsForPrompt(tools);
        if (toolPrompt) {
          this.conversationHistory.push({ role: "system", content: toolPrompt });
        }

        const retry = await this.runStream(
          undefined,
          onToken,
          onReasoning,
          onReasoningEnd,
        );

        // Remove the injected system message — it was a one-shot injection
        if (toolPrompt) {
          const idx = this.conversationHistory.lastIndexOf(
            this.conversationHistory.find(
              (m) => m.role === "system" && m.content === toolPrompt,
            )!,
          );
          if (idx !== -1) {
            this.conversationHistory.splice(idx, 1);
          }
        }

        // Check for Kimi tool markup in the retry response
        if (containsKimiToolMarkup(retry.text)) {
          console.log(`[Agent ${this.id}] Kimi tool markup detected in retry — executing tool calls`);
          const result = await this.executeKimiToolCalls(
            retry.text,
            retry.thinking,
            tools,
            onToken,
            onReasoning,
            onReasoningEnd,
            0,
          );
          this.conversationHistory.push({
            role: "assistant",
            content: result.text,
          });
          this.setStatus(AgentStatus.Idle);
          return result;
        }

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
      return { text: finalText, thinking, hadToolCalls, timedOut: timedOut || undefined };
    } catch (error) {
      this.setStatus(AgentStatus.Error);
      getCircuitBreaker(this.llmConfig.provider).recordFailure();
      if (error instanceof RetryError) {
        console.error(`[Agent ${this.id}] Rate limited by provider — retries exhausted`);
        return { text: "Error: Rate limited by provider — retries exhausted", thinking: undefined, hadToolCalls: false, isError: true };
      }
      const errMsg =
        error instanceof Error ? error.message : "Unknown LLM error";
      console.error(`Agent ${this.id} LLM error:`, errMsg);
      return { text: `Error: ${errMsg}`, thinking: undefined, hadToolCalls: false, isError: true };
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
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean; timedOut?: boolean }> {
    // Create an AbortController so tool guards can stop the stream mid-think
    const abortController = new AbortController();

    // If an external abort signal fires (e.g. from Worker.abort()), propagate to our controller
    if (this._externalAbortController) {
      const externalSignal = this._externalAbortController.signal;
      if (externalSignal.aborted) {
        abortController.abort();
      } else {
        externalSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
    }

    const result = await stream(
      this.llmConfig,
      this.conversationHistory,
      tools,
      {
        abortSignal: abortController.signal,
        onStepFinish: () => {
          if (this._shouldAbortThink) {
            console.log(`[Agent ${this.id}] _shouldAbortThink is set — aborting stream after step`);
            abortController.abort();
          }
        },
      },
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
    const TOOL_EXEC_TIMEOUT = 25 * 60_000; // 25 min for long-running tool calls (e.g. opencode_task)

    const TIMEOUT_SENTINEL = Symbol("timeout");
    const nextWithTimeout = (timeoutMs: number) =>
      Promise.race([
        iterator.next(),
        new Promise<{ done: true; value: typeof TIMEOUT_SENTINEL }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: TIMEOUT_SENTINEL }), timeoutMs),
        ),
      ]);

    const first = await nextWithTimeout(FIRST_CHUNK_TIMEOUT);

    if (first.done) {
      const wasTimeout = first.value === TIMEOUT_SENTINEL;
      console.warn(`[Agent ${this.id}] Stream produced no data within ${FIRST_CHUNK_TIMEOUT / 1000}s (tools=${!!tools}, timeout=${wasTimeout})`);
      debug("runStream", `First-chunk timeout after ${FIRST_CHUNK_TIMEOUT / 1000}s — agent=${this.id} tools=${!!tools}`);
      return { text: "", thinking: undefined, hadToolCalls: false, timedOut: wasTimeout };
    }

    // Track whether we've entered Kimi tool-call markup so we can
    // suppress streaming those tokens to the user.
    let kimiMarkupDetected = false;
    // Track pending tool calls — use longer timeout while tools are executing
    let pendingToolCalls = 0;

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

        // Always accumulate the full response (needed for parsing later)
        fullResponse += part.textDelta;

        if (!kimiMarkupDetected) {
          // Check if we've hit the start of Kimi tool markup
          const markupIdx = findToolMarkupStart(fullResponse);
          if (markupIdx !== -1) {
            kimiMarkupDetected = true;
            // Emit only the portion of this token that falls before the markup
            const alreadyEmitted = fullResponse.length - part.textDelta.length;
            const safeEnd = markupIdx - alreadyEmitted;
            if (safeEnd > 0) {
              onToken?.(part.textDelta.slice(0, safeEnd), messageId);
            }
          } else {
            onToken?.(part.textDelta, messageId);
          }
        }
        // If kimiMarkupDetected, swallow the token (don't forward to onToken)
      } else if (part.type === "tool-call") {
        hadToolCalls = true;
        pendingToolCalls++;
        console.log(`[Agent ${this.id}] Tool call: ${part.toolName}(${JSON.stringify(part.args ?? {}).slice(0, 200)})`);
        this.onAgentToolCall?.(this.id, part.toolName, (part.args ?? {}) as Record<string, unknown>);
        this.persistActivity("tool_call", JSON.stringify(part.args ?? {}), {
          toolName: part.toolName,
          args: part.args ?? {},
        }, messageId);
      } else if (part.type === "tool-result") {
        pendingToolCalls = Math.max(0, pendingToolCalls - 1);
        const resultStr = typeof part.result === "string" ? part.result : JSON.stringify(part.result ?? "");
        console.log(`[Agent ${this.id}] Tool result (${part.toolName}): ${resultStr.slice(0, 300)}`);
      }
    };

    processPart(first.value);

    // Process remaining parts — use longer timeout while tools are executing
    let midStreamTimedOut = false;
    try {
      while (true) {
        const timeout = pendingToolCalls > 0 ? TOOL_EXEC_TIMEOUT : CHUNK_TIMEOUT;
        const next = await nextWithTimeout(timeout);
        if (next.done) {
          if (next.value === TIMEOUT_SENTINEL) {
            midStreamTimedOut = true;
            const timeoutLabel = pendingToolCalls > 0 ? "tool-exec" : "chunk";
            console.warn(`[Agent ${this.id}] Mid-stream ${timeoutLabel} timeout after ${timeout / 1000}s (accumulated ${fullResponse.length} chars)`);
            debug("runStream", `Mid-stream ${timeoutLabel} timeout after ${timeout / 1000}s — agent=${this.id} chars=${fullResponse.length}`);
          }
          break;
        }
        processPart(next.value);
      }
    } catch (err: unknown) {
      // AbortError is expected when _shouldAbortThink fires — treat as stream-done
      if (err instanceof Error && err.name === "AbortError") {
        console.log(`[Agent ${this.id}] Stream aborted by tool guard — returning accumulated text`);
      } else {
        throw err; // Re-throw unexpected errors
      }
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

    // Capture token usage from the stream result (fire-and-forget)
    this.captureTokenUsage(result as any, messageId);

    // Detect Kimi K2.5 proprietary tool-call markup in the response.
    // If found, execute the tools and recurse for the follow-up response.
    if (tools && containsKimiToolMarkup(fullResponse)) {
      console.log(`[Agent ${this.id}] Kimi tool markup detected — executing tool calls`);
      return this.executeKimiToolCalls(
        fullResponse,
        reasoning || undefined,
        tools,
        onToken,
        onReasoning,
        onReasoningEnd,
        0,
      );
    }

    return { text: fullResponse, thinking: reasoning || undefined, hadToolCalls, timedOut: midStreamTimedOut || undefined };
  }

  /**
   * Handle Kimi K2.5 proprietary tool-call markup.
   *
   * Parses the markup, executes each tool, pushes assistant + tool messages
   * into conversation history, and recurses via runStream() so the model
   * can see the tool results and produce a follow-up response.
   */
  private async executeKimiToolCalls(
    rawResponse: string,
    thinking: string | undefined,
    tools: Record<string, unknown>,
    onToken?: (token: string, messageId: string) => void,
    onReasoning?: (token: string, messageId: string) => void,
    onReasoningEnd?: (messageId: string) => void,
    depth: number = 0,
  ): Promise<{ text: string; thinking: string | undefined; hadToolCalls: boolean; timedOut?: boolean }> {
    const MAX_DEPTH = 5;
    if (depth >= MAX_DEPTH) {
      console.warn(`[Agent ${this.id}] Kimi tool recursion depth limit (${MAX_DEPTH}) reached — returning as-is`);
      const { cleanText } = parseKimiToolCalls(rawResponse);
      return { text: cleanText || rawResponse, thinking, hadToolCalls: true };
    }

    const { cleanText, toolCalls } = parseKimiToolCalls(rawResponse);

    if (toolCalls.length === 0) {
      // Markup was malformed — treat as a normal response
      return { text: rawResponse, thinking, hadToolCalls: false };
    }

    // Log each tool call
    for (const tc of toolCalls) {
      console.log(`[Agent ${this.id}] Kimi tool call: ${tc.name}(${JSON.stringify(tc.args).slice(0, 200)})`);
      this.onAgentToolCall?.(this.id, tc.name, tc.args);
    }

    // Execute each tool and collect results
    const toolResults: { toolCallId: string; toolName: string; result: unknown }[] = [];
    for (const tc of toolCalls) {
      const toolDef = tools[tc.name] as { execute?: (args: Record<string, unknown>) => Promise<unknown> } | undefined;
      let result: unknown;
      if (toolDef?.execute) {
        try {
          result = await toolDef.execute(tc.args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        result = `Error: Tool "${tc.name}" not found or has no execute method`;
      }
      toolResults.push({ toolCallId: tc.toolCallId, toolName: tc.name, result });

      const resultStr = typeof result === "string" ? result : JSON.stringify(result ?? "");
      console.log(`[Agent ${this.id}] Kimi tool result (${tc.name}): ${resultStr.slice(0, 300)}`);
    }

    // Push assistant message with tool-call parts into conversation history
    this.conversationHistory.push({
      role: "assistant" as const,
      content: [
        ...(cleanText ? [{ type: "text" as const, text: cleanText }] : []),
        ...toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.name,
          args: tc.args,
        })),
      ],
    });

    // Push tool-result message
    this.conversationHistory.push({
      role: "tool" as const,
      content: toolResults.map((tr) => ({
        type: "tool-result" as const,
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        result: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result ?? ""),
      })),
    });

    // Recurse: let the model see tool results and produce a follow-up.
    // Inject tool descriptions as text (the model doesn't support SDK tools,
    // which is why we're in this Kimi-markup path in the first place).
    const toolPrompt = formatToolsForPrompt(tools);
    if (toolPrompt) {
      this.conversationHistory.push({ role: "system", content: toolPrompt });
    }

    const followUp = await this.runStream(undefined, onToken, onReasoning, onReasoningEnd);

    // Remove the injected tool-description system message
    if (toolPrompt) {
      const idx = this.conversationHistory.lastIndexOf(
        this.conversationHistory.find(
          (m) => m.role === "system" && m.content === toolPrompt,
        )!,
      );
      if (idx !== -1) {
        this.conversationHistory.splice(idx, 1);
      }
    }

    // Combine thinking from both rounds
    const combinedThinking = [thinking, followUp.thinking].filter(Boolean).join("\n\n");

    // If the follow-up also contains Kimi markup, recurse
    if (containsKimiToolMarkup(followUp.text)) {
      return this.executeKimiToolCalls(
        followUp.text,
        combinedThinking || undefined,
        tools,
        onToken,
        onReasoning,
        onReasoningEnd,
        depth + 1,
      );
    }

    return {
      text: followUp.text,
      thinking: combinedThinking || undefined,
      hadToolCalls: true,
    };
  }

  /** Get the agent's data representation */
  toData(): AgentData {
    return {
      id: this.id,
      name: this.name,
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

  /** Prune conversation history to keep it within bounds */
  protected pruneConversationHistory(maxMessages: number = 40): void {
    if (this.conversationHistory.length <= maxMessages) return;

    const keepRecent = 20;
    const system = this.conversationHistory[0]; // system prompt
    const recent = this.conversationHistory.slice(-keepRecent);
    const pruned = this.conversationHistory.slice(1, -keepRecent);

    // Compress pruned messages into a summary
    const summary = pruned
      .map((m) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `[${m.role}]: ${content.slice(0, 150)}`;
      })
      .join("\n");

    this.conversationHistory = [
      system,
      { role: "system", content: `[History summary — ${pruned.length} older messages condensed]\n${summary}` },
      ...recent,
    ];

    console.log(`[Agent ${this.id}] Pruned conversation history: ${pruned.length + keepRecent + 1} → ${this.conversationHistory.length} messages`);
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

  /** Fire-and-forget: read usage from the stream result and persist */
  private captureTokenUsage(result: { usage: Promise<{ promptTokens: number; completionTokens: number }> }, messageId: string) {
    result.usage
      .then((usage) => {
        if (usage.promptTokens > 0 || usage.completionTokens > 0) {
          this.persistTokenUsage(usage.promptTokens, usage.completionTokens, messageId);
        }
      })
      .catch((err) => {
        console.error(`[Agent ${this.id}] Failed to read usage:`, err);
      });
  }

  /** Insert a token usage record into the database */
  private persistTokenUsage(inputTokens: number, outputTokens: number, messageId: string) {
    try {
      const db = getDb();
      const resolved = resolveProviderCredentials(this.llmConfig.provider);
      const cost = calculateCost(this.llmConfig.model, inputTokens, outputTokens);
      db.insert(schema.tokenUsage)
        .values({
          id: nanoid(),
          agentId: this.id,
          provider: resolved.type,
          model: this.llmConfig.model,
          inputTokens,
          outputTokens,
          cost,
          projectId: this.projectId,
          messageId,
          timestamp: new Date().toISOString(),
        })
        .run();
      console.log(`[Agent ${this.id}] Token usage: ${inputTokens} in / ${outputTokens} out, cost=${cost} microcents`);
    } catch (err) {
      console.error(`[Agent ${this.id}] Failed to persist token usage:`, err);
    }
  }

  private persistAgent(options: AgentOptions) {
    const db = getDb();
    const values = {
      id: this.id,
      name: this.name,
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
