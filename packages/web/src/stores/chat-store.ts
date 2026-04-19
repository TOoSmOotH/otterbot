import { create } from "zustand";
import { getSocket } from "../lib/socket";
import type { StreamChunk } from "@otterbot/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  error?: string;
}

interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  connected: boolean;
  toolEvents: Array<{ id: string; name: string; result?: unknown }>;
  connect: () => void;
  send: (text: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  streaming: false,
  connected: false,
  toolEvents: [],

  connect: () => {
    if (get().connected) return;
    const socket = getSocket();

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));

    socket.on("chat:joined", (payload: { conversationId: string }) => {
      set({ conversationId: payload.conversationId });
    });

    socket.on("chat:stream", (chunk: StreamChunk) => {
      set((state) => {
        const messages = state.messages.slice();
        const last = messages[messages.length - 1];
        switch (chunk.kind) {
          case "token":
            if (last && last.role === "assistant" && last.pending) {
              messages[messages.length - 1] = { ...last, content: last.content + chunk.text };
            } else {
              messages.push({
                id: `tmp-${Date.now()}`,
                role: "assistant",
                content: chunk.text,
                pending: true,
              });
            }
            return { messages };
          case "tool_start":
            return {
              toolEvents: [...state.toolEvents, { id: chunk.id, name: chunk.name }],
              messages,
            };
          case "tool_end":
            return {
              toolEvents: state.toolEvents.map((e) =>
                e.id === chunk.id ? { ...e, result: chunk.result } : e,
              ),
              messages,
            };
          case "error":
            if (last && last.role === "assistant" && last.pending) {
              messages[messages.length - 1] = { ...last, error: chunk.message, pending: false };
            } else {
              messages.push({
                id: `err-${Date.now()}`,
                role: "assistant",
                content: "",
                error: chunk.message,
              });
            }
            return { messages };
          default:
            return { messages };
        }
      });
    });

    socket.on("chat:done", () => {
      set((state) => ({
        streaming: false,
        messages: state.messages.map((m) => (m.pending ? { ...m, pending: false } : m)),
      }));
    });

    socket.emit("chat:join", {});
  },

  send: (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `user-${Date.now()}`, role: "user", content: trimmed },
      ],
      streaming: true,
    }));
    getSocket().emit("chat:message", { text: trimmed });
  },

  reset: () => {
    getSocket().emit("chat:close");
    set({ messages: [], toolEvents: [], streaming: false, conversationId: null });
  },
}));
