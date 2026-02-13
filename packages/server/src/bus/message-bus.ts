import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { BusMessage, MessageType } from "@smoothbot/shared";

type MessageHandler = (message: BusMessage) => void | Promise<void>;

export class MessageBus {
  private handlers = new Map<string, MessageHandler>();
  private broadcastHandlers: MessageHandler[] = [];
  private correlationHandlers = new Map<
    string,
    (message: BusMessage) => void
  >();

  /** Register a handler for messages to a specific agent */
  subscribe(agentId: string, handler: MessageHandler): void {
    this.handlers.set(agentId, handler);
  }

  /** Unsubscribe an agent's handler */
  unsubscribe(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /** Register a handler that receives ALL messages (for UI broadcast) */
  onBroadcast(handler: MessageHandler): void {
    this.broadcastHandlers.push(handler);
  }

  /** Remove a broadcast handler */
  offBroadcast(handler: MessageHandler): void {
    this.broadcastHandlers = this.broadcastHandlers.filter(
      (h) => h !== handler,
    );
  }

  /** Send a message through the bus: persist → route → broadcast */
  send(params: {
    fromAgentId: string | null;
    toAgentId: string | null;
    type: MessageType;
    content: string;
    metadata?: Record<string, unknown>;
    projectId?: string;
    conversationId?: string;
    correlationId?: string;
  }): BusMessage {
    const message: BusMessage = {
      id: nanoid(),
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      type: params.type,
      content: params.content,
      metadata: params.metadata ?? {},
      projectId: params.projectId,
      conversationId: params.conversationId,
      correlationId: params.correlationId,
      timestamp: new Date().toISOString(),
    };

    // 1. Persist
    this.persist(message);

    // 2. Check if this is a correlated reply
    if (message.correlationId) {
      const correlationHandler = this.correlationHandlers.get(
        message.correlationId,
      );
      if (correlationHandler) {
        correlationHandler(message);
      }
    }

    // 3. Route to target agent
    if (params.toAgentId) {
      const handler = this.handlers.get(params.toAgentId);
      if (handler) {
        Promise.resolve(handler(message)).catch((err) => {
          console.error(
            `[MessageBus] Error in handler for agent ${params.toAgentId}:`,
            err,
          );
        });
      } else {
        console.warn(
          `[MessageBus] No handler for agent "${params.toAgentId}" — message dropped. Registered: [${Array.from(this.handlers.keys()).join(", ")}]`,
        );
      }
    }

    // 4. Broadcast to all listeners (UI)
    for (const bh of this.broadcastHandlers) {
      Promise.resolve(bh(message)).catch((err) => {
        console.error("[MessageBus] Error in broadcast handler:", err);
      });
    }

    return message;
  }

  /**
   * Send a message and wait for a correlated reply.
   * Returns the reply BusMessage, or null on timeout.
   */
  request(
    params: {
      fromAgentId: string | null;
      toAgentId: string | null;
      type: MessageType;
      content: string;
      metadata?: Record<string, unknown>;
      projectId?: string;
      conversationId?: string;
    },
    timeoutMs = 30_000,
  ): Promise<BusMessage | null> {
    const correlationId = nanoid();

    return new Promise<BusMessage | null>((resolve) => {
      const timer = setTimeout(() => {
        this.correlationHandlers.delete(correlationId);
        resolve(null);
      }, timeoutMs);

      this.correlationHandlers.set(correlationId, (reply) => {
        // Ignore the outgoing request — only resolve on the actual reply
        if (reply.fromAgentId === params.fromAgentId) return;
        clearTimeout(timer);
        this.correlationHandlers.delete(correlationId);
        resolve(reply);
      });

      this.send({ ...params, correlationId });
    });
  }

  /** Get message history, optionally filtered */
  getHistory(options?: {
    projectId?: string;
    agentId?: string;
    limit?: number;
  }): BusMessage[] {
    const db = getDb();
    let query = db.select().from(schema.messages).$dynamic();

    // Drizzle doesn't support dynamic where chaining easily with better-sqlite3,
    // so we'll use the raw results and filter
    const results = db
      .select()
      .from(schema.messages)
      .orderBy(schema.messages.timestamp)
      .all();

    let filtered = results as unknown as BusMessage[];

    if (options?.projectId) {
      filtered = filtered.filter((m) => m.projectId === options.projectId);
    }

    if (options?.agentId) {
      filtered = filtered.filter(
        (m) =>
          m.fromAgentId === options.agentId ||
          m.toAgentId === options.agentId,
      );
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /** Get messages for a specific conversation, ordered by timestamp */
  getConversationMessages(conversationId: string): BusMessage[] {
    const db = getDb();
    const results = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(schema.messages.timestamp)
      .all();
    return results as unknown as BusMessage[];
  }

  private persist(message: BusMessage): void {
    const db = getDb();
    db.insert(schema.messages)
      .values({
        id: message.id,
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        type: message.type,
        content: message.content,
        metadata: message.metadata,
        projectId: message.projectId,
        conversationId: message.conversationId,
        correlationId: message.correlationId,
        timestamp: message.timestamp,
      })
      .run();
  }
}
