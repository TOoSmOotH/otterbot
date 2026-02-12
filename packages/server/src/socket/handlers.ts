import type { Server, Socket } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@smoothbot/shared";
import { MessageType, type Agent, type BusMessage, type Conversation } from "@smoothbot/shared";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import type { MessageBus } from "../bus/message-bus.js";
import type { COO } from "../agents/coo.js";
import type { Registry } from "../registry/registry.js";
import type { BaseAgent } from "../agents/agent.js";
import { getDb, schema } from "../db/index.js";
import { isTTSEnabled, getConfiguredTTSProvider, stripMarkdown } from "../tts/tts.js";
import { getConfig } from "../auth/auth.js";

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function setupSocketHandlers(
  io: TypedServer,
  bus: MessageBus,
  coo: COO,
  registry: Registry,
) {
  // Broadcast all bus messages to connected clients
  bus.onBroadcast(async (message: BusMessage) => {
    io.emit("bus:message", message);

    // If the message is from COO to CEO (null), also emit as coo:response
    if (message.fromAgentId === "coo" && message.toAgentId === null) {
      io.emit("coo:response", message);

      // TTS: synthesize and emit audio (best-effort, never blocks text)
      try {
        if (isTTSEnabled()) {
          const provider = getConfiguredTTSProvider();
          const plainText = message.content
            ? stripMarkdown(message.content)
            : "";
          if (provider && plainText) {
            const voice = getConfig("tts:voice") ?? "af_heart";
            const speed = parseFloat(getConfig("tts:speed") ?? "1");
            const { audio, contentType } = await provider.synthesize(
              plainText,
              voice,
              speed,
            );
            io.emit("coo:audio", {
              messageId: message.id,
              audio: audio.toString("base64"),
              contentType,
            });
          }
        }
      } catch (err) {
        console.error("TTS synthesis failed:", err);
      }
    }
  });

  io.on("connection", (socket: TypedSocket) => {
    console.log(`Client connected: ${socket.id}`);

    // CEO sends a message to the COO
    socket.on("ceo:message", (data, callback) => {
      const db = getDb();
      let conversationId = data.conversationId ?? coo.getCurrentConversationId();

      // Lazy conversation creation: first message creates the conversation
      if (!conversationId) {
        conversationId = nanoid();
        const now = new Date().toISOString();
        const title = data.content.slice(0, 80);
        const conversation: Conversation = {
          id: conversationId,
          title,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(schema.conversations).values(conversation).run();
        coo.startNewConversation(conversationId);
        io.emit("conversation:created", conversation);
      } else {
        // Update the conversation's updatedAt
        db.update(schema.conversations)
          .set({ updatedAt: new Date().toISOString() })
          .where(eq(schema.conversations.id, conversationId))
          .run();
      }

      const message = bus.send({
        fromAgentId: null, // CEO
        toAgentId: "coo",
        type: MessageType.Chat,
        content: data.content,
        conversationId,
      });

      if (callback) {
        callback({ messageId: message.id, conversationId });
      }
    });

    // CEO starts a new chat (reset COO conversation)
    socket.on("ceo:new-chat", (callback) => {
      coo.resetConversation();
      if (callback) {
        callback({ ok: true });
      }
    });

    // List all conversations
    socket.on("ceo:list-conversations", (callback) => {
      const db = getDb();
      const conversations = db
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updatedAt))
        .all();
      callback(conversations as Conversation[]);
    });

    // Load a specific conversation
    socket.on("ceo:load-conversation", (data, callback) => {
      const messages = bus.getConversationMessages(data.conversationId);
      coo.loadConversation(data.conversationId, messages);
      callback({ messages });
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

export function emitCooThinking(
  io: TypedServer,
  token: string,
  messageId: string,
) {
  io.emit("coo:thinking", { token, messageId });
}

export function emitCooThinkingEnd(io: TypedServer, messageId: string) {
  io.emit("coo:thinking-end", { messageId });
}
