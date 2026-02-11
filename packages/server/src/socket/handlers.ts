import type { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@smoothbot/shared";
import { MessageType, type Agent, type BusMessage } from "@smoothbot/shared";
import { eq } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import type { COO } from "../agents/coo.js";
import type { Registry } from "../registry/registry.js";
import type { BaseAgent } from "../agents/agent.js";
import { getDb, schema } from "../db/index.js";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function setupSocketHandlers(
  io: TypedServer,
  bus: MessageBus,
  coo: COO,
  registry: Registry,
) {
  // Broadcast all bus messages to connected clients
  bus.onBroadcast((message: BusMessage) => {
    io.emit("bus:message", message);

    // If the message is from COO to CEO (null), also emit as coo:response
    if (message.fromAgentId === "coo" && message.toAgentId === null) {
      io.emit("coo:response", message);
    }
  });

  io.on("connection", (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    // CEO sends a message to the COO
    socket.on("ceo:message", (data, callback) => {
      const message = bus.send({
        fromAgentId: null, // CEO
        toAgentId: "coo",
        type: MessageType.Chat,
        content: data.content,
      });

      if (callback) {
        callback({ messageId: message.id });
      }
    });

    // CEO starts a new chat (reset COO conversation)
    socket.on("ceo:new-chat", (callback) => {
      coo.resetConversation();
      if (callback) {
        callback({ ok: true });
      }
    });

    // Request registry entries
    socket.on("registry:list", (callback) => {
      const entries = registry.list();
      callback(entries);
    });

    // Inspect a specific agent
    socket.on("agent:inspect", (data, callback) => {
      const db = getDb();
      const agent = db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, data.agentId))
        .get();
      callback((agent as Agent | undefined) ?? null);
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

/** Emit agent lifecycle events to all clients */
export function emitAgentSpawned(
  io: TypedServer,
  agent: BaseAgent,
) {
  io.emit("agent:spawned", agent.toData());
}

export function emitAgentStatus(
  io: TypedServer,
  agentId: string,
  status: string,
) {
  io.emit("agent:status", { agentId, status: status as any });
}

export function emitAgentDestroyed(io: TypedServer, agentId: string) {
  io.emit("agent:destroyed", { agentId });
}

export function emitCooStream(
  io: TypedServer,
  token: string,
  messageId: string,
) {
  io.emit("coo:stream", { token, messageId });
}
