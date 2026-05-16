import { desc } from "drizzle-orm";
import type { AgentMessage } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import type { Transport } from "./transports/transport.js";

/** A message ready to publish — the bus assigns `seq` and `createdAt`. */
export type OutboundMessage = Omit<AgentMessage, "seq" | "createdAt"> & {
  createdAt?: string;
};

/** Deliver a message to a target agent runtime. `"*"` means broadcast to all. */
export type DeliverFn = (agentId: string, msg: AgentMessage) => void;

/** Surface a message to the UI (Socket.IO). */
export type EmitFn = (msg: AgentMessage) => void;

interface Pending {
  resolve: (msg: AgentMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The agent-to-agent message bus. Every message is persisted to the control
 * DB's `bus_messages` table (so the UI can replay full history), surfaced to
 * the UI, delivered to the target runtime(s), and handed to the active
 * transport. `request()` publishes a request and resolves when the correlated
 * response arrives — this is how the COO delegates and awaits results.
 */
export class MessageBus {
  private deliver: DeliverFn = () => {};
  private emit: EmitFn = () => {};
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly control: ControlDb,
    private readonly transport: Transport
  ) {
    this.transport.onReceive((msg) => this.ingest(msg));
  }

  setDeliver(fn: DeliverFn): void {
    this.deliver = fn;
  }

  setEmit(fn: EmitFn): void {
    this.emit = fn;
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  async stop(): Promise<void> {
    await this.transport.stop();
  }

  /** Publish a message: persist, surface to UI, deliver locally, send over transport. */
  publish(input: OutboundMessage): AgentMessage {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const res = this.control.db
      .insert(controlSchema.busMessages)
      .values({
        id: input.id,
        kind: input.kind,
        fromAgentId: input.from,
        toAgentId: input.to,
        threadId: input.threadId,
        correlationId: input.correlationId,
        rootSpawnId: input.rootSpawnId,
        body: input.body,
        payload: input.payload ?? null,
        status: input.status ?? null,
        transport: input.transport,
        createdAt,
      })
      .run();
    const msg: AgentMessage = { ...input, createdAt, seq: Number(res.lastInsertRowid) };
    this.dispatch(msg, true);
    return msg;
  }

  /** Publish a request and resolve when the correlated response arrives. */
  request(input: OutboundMessage, timeoutMs = 120_000): Promise<AgentMessage> {
    return new Promise<AgentMessage>((resolve, reject) => {
      // Register the pending entry BEFORE publishing — a transport may deliver
      // the request and its response synchronously.
      const timer = setTimeout(() => {
        this.pending.delete(input.id);
        reject(new Error(`request to ${input.to ?? "broadcast"} timed out`));
      }, timeoutMs);
      this.pending.set(input.id, { resolve, reject, timer });
      try {
        this.publish(input);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(input.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Most recent messages, oldest-first, for UI replay. */
  history(limit = 200): AgentMessage[] {
    const rows = this.control.db
      .select()
      .from(controlSchema.busMessages)
      .orderBy(desc(controlSchema.busMessages.seq))
      .limit(limit)
      .all();
    return rows.reverse().map(rowToMessage);
  }

  /** Handle a message arriving from a transport (e.g. Discord). */
  private ingest(msg: AgentMessage): void {
    // Persist with a fresh seq, then dispatch without echoing back to the wire.
    const res = this.control.db
      .insert(controlSchema.busMessages)
      .values({
        id: msg.id,
        kind: msg.kind,
        fromAgentId: msg.from,
        toAgentId: msg.to,
        threadId: msg.threadId,
        correlationId: msg.correlationId,
        rootSpawnId: msg.rootSpawnId,
        body: msg.body,
        payload: msg.payload ?? null,
        status: msg.status ?? null,
        transport: msg.transport,
        createdAt: msg.createdAt,
      })
      .run();
    this.dispatch({ ...msg, seq: Number(res.lastInsertRowid) }, false);
  }

  private dispatch(msg: AgentMessage, toTransport: boolean): void {
    this.emit(msg);
    this.resolvePending(msg);
    this.deliver(msg.to ?? "*", msg);
    if (toTransport) void this.transport.send(msg);
  }

  private resolvePending(msg: AgentMessage): void {
    if (msg.kind !== "response" || !msg.correlationId) return;
    const pending = this.pending.get(msg.correlationId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.correlationId);
    pending.resolve(msg);
  }
}

function rowToMessage(row: typeof controlSchema.busMessages.$inferSelect): AgentMessage {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind as AgentMessage["kind"],
    from: row.fromAgentId,
    to: row.toAgentId,
    threadId: row.threadId,
    correlationId: row.correlationId,
    rootSpawnId: row.rootSpawnId,
    body: row.body,
    payload: row.payload ?? undefined,
    status: (row.status as AgentMessage["status"]) ?? undefined,
    transport: row.transport as AgentMessage["transport"],
    createdAt: row.createdAt,
  };
}
