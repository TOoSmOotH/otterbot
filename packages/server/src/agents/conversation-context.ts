import type { ChatMessage } from "../llm/adapter.js";
import type { BusMessage } from "@smoothbot/shared";

export interface ConversationContext {
  conversationId: string;
  projectId: string | null;
  history: ChatMessage[];
  charterInjected: boolean;
}

/**
 * Manages multiple conversation contexts for the COO agent.
 * Each conversation gets its own history, keyed by conversationId.
 */
export class ConversationContextManager {
  private contexts = new Map<string, ConversationContext>();
  private systemPrompt: string;

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  /** Get or create a context for a conversation */
  getOrCreate(conversationId: string, projectId: string | null): ConversationContext {
    let ctx = this.contexts.get(conversationId);
    if (!ctx) {
      ctx = {
        conversationId,
        projectId,
        history: [{ role: "system", content: this.systemPrompt }],
        charterInjected: false,
      };
      this.contexts.set(conversationId, ctx);
    }
    return ctx;
  }

  /** Get a context by ID (returns undefined if not cached) */
  get(conversationId: string): ConversationContext | undefined {
    return this.contexts.get(conversationId);
  }

  /**
   * Load a conversation from persisted messages, optionally injecting a charter.
   * This replaces the context's history entirely.
   */
  load(
    conversationId: string,
    projectId: string | null,
    messages: BusMessage[],
    charter?: string | null,
  ): ConversationContext {
    const history: ChatMessage[] = [
      { role: "system", content: this.systemPrompt },
    ];

    // Inject charter as system context if available
    let charterInjected = false;
    if (charter) {
      history.push({
        role: "system",
        content: `[PROJECT CHARTER]\n${charter}\n[/PROJECT CHARTER]\nYou are in the context of this project. Reference the charter for goals, scope, and decisions.`,
      });
      charterInjected = true;
    }

    // Replay persisted messages
    for (const msg of messages) {
      if (msg.type !== "chat") continue;
      if (msg.fromAgentId === null) {
        history.push({ role: "user", content: msg.content });
      } else if (msg.fromAgentId === "coo") {
        history.push({ role: "assistant", content: msg.content });
      }
    }

    const ctx: ConversationContext = {
      conversationId,
      projectId,
      history,
      charterInjected,
    };
    this.contexts.set(conversationId, ctx);
    return ctx;
  }

  /** Evict a context from cache */
  evict(conversationId: string): void {
    this.contexts.delete(conversationId);
  }

  /** Reset a context to just the system prompt */
  reset(conversationId: string): void {
    const ctx = this.contexts.get(conversationId);
    if (ctx) {
      ctx.history = [{ role: "system", content: this.systemPrompt }];
      ctx.charterInjected = false;
    }
  }

  /** Update the system prompt (used if prompt changes) */
  updateSystemPrompt(systemPrompt: string): void {
    this.systemPrompt = systemPrompt;
  }
}
