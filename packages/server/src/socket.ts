import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Orchestrator } from "./orchestrator/orchestrator.js";
import { summarizeConversation } from "./memory/summarizer.js";
import { extractFactsFromConversation } from "./memory/extractor.js";
import { maybeAuthorSkill } from "./skills/skill-author.js";

const IDLE_CLOSE_MS = 5 * 60 * 1000;

interface JoinedConversation {
  agentId: string;
  conversationId: string;
  idleTimer: NodeJS.Timeout | null;
}

/**
 * Multi-agent socket layer. Every chat event carries an `agentId`, so a single
 * client can hold conversations with several agents at once. Agent status
 * changes are broadcast to all clients.
 */
export function attachSocketServer(http: HttpServer, orch: Orchestrator): SocketIOServer {
  const io = new SocketIOServer(http, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  // Push every agent status transition to all connected clients.
  orch.onStatusChange((agentId, status) => {
    io.emit("agent:status", { agentId, status });
  });

  // Surface every agent-to-agent bus message to the Activity View.
  orch.getBus().setEmit((msg) => {
    io.emit("bus:message", msg);
  });

  io.on("connection", (socket) => {
    /** One joined conversation per agent this socket is chatting with. */
    const conversations = new Map<string, JoinedConversation>();

    const ensureJoined = (agentId: string): JoinedConversation => {
      let joined = conversations.get(agentId);
      if (!joined) {
        joined = {
          agentId,
          conversationId: `conv-${agentId}-${Date.now()}`,
          idleTimer: null,
        };
        conversations.set(agentId, joined);
        socket.emit("chat:joined", { agentId, conversationId: joined.conversationId });
      }
      return joined;
    };

    socket.on("chat:join", (payload: { agentId?: string; conversationId?: string }) => {
      const agentId = payload.agentId || "coo";
      const conversationId = payload.conversationId || `conv-${agentId}-${Date.now()}`;
      conversations.set(agentId, { agentId, conversationId, idleTimer: null });
      socket.emit("chat:joined", { agentId, conversationId });
    });

    socket.on("chat:message", async (payload: { agentId?: string; text: string }) => {
      const agentId = payload.agentId || "coo";
      const joined = ensureJoined(agentId);
      resetIdle(joined, () => closeSession(orch, agentId, joined.conversationId));

      const runtime = orch.getRuntime(agentId);
      if (!runtime) {
        socket.emit("chat:stream", {
          agentId,
          chunk: { kind: "error", message: `Unknown agent: ${agentId}` },
        });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
        return;
      }

      try {
        await runtime.respond({
          conversationId: joined.conversationId,
          userMessage: payload.text,
          onChunk: (chunk) => socket.emit("chat:stream", { agentId, chunk }),
        });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.emit("chat:stream", { agentId, chunk: { kind: "error", message } });
        socket.emit("chat:done", { agentId, conversationId: joined.conversationId });
      }
    });

    socket.on("chat:close", (payload: { agentId?: string }) => {
      const agentId = payload.agentId || "coo";
      const joined = conversations.get(agentId);
      if (joined) void closeSession(orch, agentId, joined.conversationId);
    });

    socket.on("disconnect", () => {
      for (const joined of conversations.values()) {
        if (joined.idleTimer) clearTimeout(joined.idleTimer);
        void closeSession(orch, joined.agentId, joined.conversationId);
      }
    });
  });

  return io;
}

function resetIdle(joined: JoinedConversation, onIdle: () => void) {
  if (joined.idleTimer) clearTimeout(joined.idleTimer);
  joined.idleTimer = setTimeout(onIdle, IDLE_CLOSE_MS);
}

/**
 * Run the end-of-session learning loop for one agent against its own context:
 * summarize → extract facts → rebuild user profile → optionally author a skill.
 * Failures are logged, never thrown.
 */
export async function closeSession(
  orch: Orchestrator,
  agentId: string,
  conversationId: string
): Promise<void> {
  const ctx = orch.getContext(agentId);
  if (!ctx) return;
  try {
    await summarizeConversation(ctx, conversationId);
  } catch (err) {
    console.error("[close] summarize failed:", err);
  }
  try {
    await extractFactsFromConversation(ctx, conversationId);
  } catch (err) {
    console.error("[close] extract failed:", err);
  }
  try {
    await ctx.userProfile.rebuildFromSession(conversationId);
  } catch (err) {
    console.error("[close] profile rebuild failed:", err);
  }
  try {
    await maybeAuthorSkill(ctx, conversationId);
  } catch (err) {
    console.error("[close] skill author failed:", err);
  }
}
