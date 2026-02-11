import { nanoid } from "nanoid";
import { getDb, schema } from "../db/index.js";
import type { BusMessage, MessageType } from "@smoothbot/shared";

type MessageHandler = (message: BusMessage) => void;

export class MessageBus {
  private handlers = new Map<string, MessageHandler>();
  private broadcastHandlers: MessageHandler[] = [];

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
  }): BusMessage {
    const message: BusMessage = {
      id: nanoid(),
      fromAgentId: params.fromAgentId,
      toAgentId: params.toAgentId,
      type: params.type,
      content: params.content,
      metadata: params.metadata ?? {},
      projectId: params.projectId,
      timestamp: new Date().toISOString(),
    };

    // 1. Persist
    this.persist(message);

    // 2. Route to target agent
    if (params.toAgentId) {
      const handler = this.handlers.get(params.toAgentId);
      if (handler) {
        handler(message);
      }
    }

    // 3. Broadcast to all listeners (UI)
    for (const handler of this.broadcastHandlers) {
      handler(message);
    }

    return message;
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
        timestamp: message.timestamp,
      })
      .run();
  }
}
