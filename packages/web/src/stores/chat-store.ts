import { create } from "zustand";
import { getSocket } from "../lib/socket";
import type { StreamChunk } from "@otterbot/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  pending?: boolean;
  error?: string;
}

interface ChatState {
  connected: boolean;
  /** Message history per agent id. */
  byAgent: Record<string, ChatMessage[]>;
  /** Whether each agent is currently streaming a response. */
  streaming: Record<string, boolean>;
  socketBound: boolean;

  connect: () => void;
  join: (agentId: string) => void;
  send: (agentId: string, text: string) => void;
  reset: (agentId: string) => void;
}

function appendChunk(messages: ChatMessage[], chunk: StreamChunk): ChatMessage[] {
  const next = messages.slice();
  const last = next[next.length - 1];
  switch (chunk.kind) {
    case "token":
      if (last && last.role === "assistant" && last.pending) {
        next[next.length - 1] = { ...last, content: last.content + chunk.text };
      } else {
        next.push({
          id: `a-${Date.now()}-${next.length}`,
          role: "assistant",
          content: chunk.text,
          pending: true,
        });
      }
      return next;
    case "tool_start":
      next.push({ id: `t-${chunk.id}`, role: "tool", content: `Used ${chunk.name}` });
      return next;
    case "tool_end":
      return next;
    case "error":
      if (last && last.role === "assistant" && last.pending) {
        next[next.length - 1] = { ...last, error: chunk.message, pending: false };
      } else {
        next.push({ id: `e-${Date.now()}`, role: "assistant", content: "", error: chunk.message });
      }
      return next;
    default:
      return next;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  connected: false,
  byAgent: {},
  streaming: {},
  socketBound: false,

  connect: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    const socket = getSocket();

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));
    if (socket.connected) set({ connected: true });

    socket.on("chat:stream", (payload: { agentId: string; chunk: StreamChunk }) => {
      set((state) => ({
        byAgent: {
          ...state.byAgent,
          [payload.agentId]: appendChunk(state.byAgent[payload.agentId] ?? [], payload.chunk),
        },
      }));
    });

    socket.on("chat:done", (payload: { agentId: string }) => {
      set((state) => ({
        streaming: { ...state.streaming, [payload.agentId]: false },
        byAgent: {
          ...state.byAgent,
          [payload.agentId]: (state.byAgent[payload.agentId] ?? []).map((m) =>
            m.pending ? { ...m, pending: false } : m
          ),
        },
      }));
    });
  },

  join: (agentId) => {
    getSocket().emit("chat:join", { agentId });
  },

  send: (agentId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      byAgent: {
        ...state.byAgent,
        [agentId]: [
          ...(state.byAgent[agentId] ?? []),
          { id: `u-${Date.now()}`, role: "user", content: trimmed },
        ],
      },
      streaming: { ...state.streaming, [agentId]: true },
    }));
    getSocket().emit("chat:message", { agentId, text: trimmed });
  },

  reset: (agentId) => {
    getSocket().emit("chat:close", { agentId });
    set((state) => ({
      byAgent: { ...state.byAgent, [agentId]: [] },
      streaming: { ...state.streaming, [agentId]: false },
    }));
  },
}));
