import { nanoid } from "nanoid";
import { streamText, type CoreMessage, type LanguageModelV1 } from "ai";
import { eq, asc } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { resolveChatModel, isModelAllowed } from "../providers/registry.js";
import { buildSystemPrompt } from "../agent/prompt.js";
import { buildAgentTools } from "../agent/tools.js";
import type { AgentContext } from "./agent-context.js";
import type { AgentServices } from "./agent-services.js";
import type { AgentStatus, AgentMessage, StreamChunk } from "@otterbot/shared";

export interface RespondArgs {
  conversationId: string;
  userMessage: string;
  onChunk: (chunk: StreamChunk) => void;
}

export interface RespondResult {
  messageId: string;
  finalText: string;
  skillsUsed: string[];
  memoriesUsed: string[];
}

/**
 * The runtime for a single agent. One instance per profile. Owns the agent's
 * resolved chat model and drives its conversational loop against the agent's
 * own isolated context (memory, skills, profile).
 */
export class AgentRuntime {
  private chatModel: LanguageModelV1;
  private _status: AgentStatus = "idle";
  private statusListener?: (status: AgentStatus) => void;
  /** Serial work queue — one agent processes one task at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    public readonly ctx: AgentContext,
    private readonly services?: AgentServices
  ) {
    const ref = ctx.profile.model.chat;
    if (!isModelAllowed(ref, ctx.profile.allowedModels)) {
      console.warn(
        `[runtime] agent ${ctx.profile.id} chat model ${ref.provider}/${ref.modelId} is not in its allowedModels list`
      );
    }
    this.chatModel = resolveChatModel(ref, ctx.secrets);
  }

  get id(): string {
    return this.ctx.profile.id;
  }

  get status(): AgentStatus {
    return this._status;
  }

  /** Register a listener notified on every status transition. */
  onStatus(listener: (status: AgentStatus) => void): void {
    this.statusListener = listener;
  }

  private setStatus(status: AgentStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.statusListener?.(status);
  }

  /** Run one conversational turn for this agent. */
  async respond(args: RespondArgs): Promise<RespondResult> {
    this.setStatus("thinking");
    try {
      const db = this.ctx.db;
      this.ensureConversation(args.conversationId);
      this.appendMessage(args.conversationId, "user", args.userMessage);

      const history = db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, args.conversationId))
        .orderBy(asc(schema.messages.createdAt))
        .all();

      const { system, skillsUsed, memoriesUsed } = await buildSystemPrompt(this.ctx, {
        userMessage: args.userMessage,
      });

      const coreMessages: CoreMessage[] = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const tools = buildAgentTools(this.ctx, this.services);

      const result = streamText({
        model: this.chatModel,
        system,
        messages: coreMessages,
        tools,
        maxSteps: 8,
      });

      let finalText = "";
      let sawWork = false;
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            finalText += part.textDelta;
            args.onChunk({ kind: "token", text: part.textDelta });
            break;
          case "tool-call":
            sawWork = true;
            this.setStatus("working");
            args.onChunk({
              kind: "tool_start",
              id: part.toolCallId,
              name: part.toolName,
              args: part.args,
            });
            break;
          case "error": {
            const message =
              part.error instanceof Error ? part.error.message : String(part.error);
            args.onChunk({ kind: "error", message });
            break;
          }
          default:
            break;
        }
      }
      void sawWork;

      const messageId = this.appendMessage(args.conversationId, "assistant", finalText);
      this.touchConversation(args.conversationId);

      return { messageId, finalText, skillsUsed, memoriesUsed };
    } finally {
      this.setStatus("idle");
    }
  }

  /**
   * Handle an inbound bus message. A `request` is processed as a turn and
   * answered with a correlated `response`; other kinds are informational.
   * Runs on the agent's serial queue.
   */
  async handleBusMessage(msg: AgentMessage): Promise<void> {
    if (msg.kind !== "request" || !this.services) return;
    this.queue = this.queue.then(async () => {
      const bus = this.services!.bus;
      let reply = "";
      try {
        const res = await this.respond({
          conversationId: `bus-${msg.threadId}`,
          userMessage: msg.body,
          onChunk: () => {},
        });
        reply = res.finalText || "(no response)";
      } catch (err) {
        reply = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      bus.publish({
        id: nanoid(),
        kind: "response",
        from: this.id,
        to: msg.from,
        threadId: msg.threadId,
        correlationId: msg.id,
        rootSpawnId: msg.rootSpawnId,
        body: reply,
        transport: this.ctx.profile.transport,
      });
    });
    await this.queue;
  }

  ensureConversation(id: string, title: string | null = null): void {
    const db = this.ctx.db;
    const existing = db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .get();
    if (existing) return;
    const now = new Date().toISOString();
    db.insert(schema.conversations)
      .values({ id, title, createdAt: now, updatedAt: now, closedAt: null })
      .run();
  }

  appendMessage(
    conversationId: string,
    role: "user" | "assistant" | "tool",
    content: string
  ): string {
    const id = nanoid();
    this.ctx.db
      .insert(schema.messages)
      .values({ id, conversationId, role, content, createdAt: new Date().toISOString() })
      .run();
    return id;
  }

  touchConversation(id: string): void {
    this.ctx.db
      .update(schema.conversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.conversations.id, id))
      .run();
  }
}
