import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { getChatAgent } from "./agent/agent.js";
import { summarizeConversation } from "./memory/summarizer.js";
import { extractFactsFromConversation } from "./memory/extractor.js";
import { maybeAuthorSkill } from "./skills/skill-author.js";
import { getUserProfileService } from "./user-profile/user-profile-service.js";

const IDLE_CLOSE_MS = 5 * 60 * 1000;

interface ClientState {
  conversationId: string;
  idleTimer: NodeJS.Timeout | null;
}

export function attachSocketServer(http: HttpServer): SocketIOServer {
  const io = new SocketIOServer(http, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  io.on("connection", (socket) => {
    const state: ClientState = { conversationId: "", idleTimer: null };

    socket.on("chat:join", (payload: { conversationId?: string }) => {
      state.conversationId = payload.conversationId || `conv-${Date.now()}`;
      socket.emit("chat:joined", { conversationId: state.conversationId });
    });

    socket.on("chat:message", async (payload: { text: string }) => {
      if (!state.conversationId) {
        state.conversationId = `conv-${Date.now()}`;
        socket.emit("chat:joined", { conversationId: state.conversationId });
      }
      resetIdle(state, () => closeSession(state.conversationId));

      try {
        await getChatAgent().respond({
          conversationId: state.conversationId,
          userMessage: payload.text,
          onChunk: (chunk) => socket.emit("chat:stream", chunk),
        });
        socket.emit("chat:done", { conversationId: state.conversationId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.emit("chat:stream", { kind: "error", message });
        socket.emit("chat:done", { conversationId: state.conversationId });
      }
    });

    socket.on("chat:close", () => {
      if (state.conversationId) void closeSession(state.conversationId);
    });

    socket.on("disconnect", () => {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      if (state.conversationId) void closeSession(state.conversationId);
    });
  });

  return io;
}

function resetIdle(state: ClientState, onIdle: () => void) {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(onIdle, IDLE_CLOSE_MS);
}

/**
 * Run the end-of-session learning loop: summarize, extract facts, rebuild
 * user profile, optionally author a skill. Each step runs sequentially
 * and failures are logged, not thrown — we never want a background
 * learning failure to surface to the user.
 */
export async function closeSession(conversationId: string): Promise<void> {
  try {
    await summarizeConversation(conversationId);
  } catch (err) {
    console.error("[close] summarize failed:", err);
  }
  try {
    await extractFactsFromConversation(conversationId);
  } catch (err) {
    console.error("[close] extract failed:", err);
  }
  try {
    await getUserProfileService().rebuildFromSession(conversationId);
  } catch (err) {
    console.error("[close] profile rebuild failed:", err);
  }
  try {
    await maybeAuthorSkill(conversationId);
  } catch (err) {
    console.error("[close] skill author failed:", err);
  }
}
