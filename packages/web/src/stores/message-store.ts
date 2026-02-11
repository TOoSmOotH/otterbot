import { create } from "zustand";
import type { BusMessage } from "@smoothbot/shared";

interface MessageState {
  /** All bus messages (for the stream panel) */
  messages: BusMessage[];
  /** Chat messages between CEO and COO */
  chatMessages: BusMessage[];
  /** Current streaming token buffer */
  streamingContent: string;
  streamingMessageId: string | null;
  /** Filter for stream panel */
  agentFilter: string | null;

  addMessage: (message: BusMessage) => void;
  setCooResponse: (message: BusMessage) => void;
  appendCooStream: (token: string, messageId: string) => void;
  setAgentFilter: (agentId: string | null) => void;
  loadHistory: (messages: BusMessage[]) => void;
  clearChat: () => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  chatMessages: [],
  streamingContent: "",
  streamingMessageId: null,
  agentFilter: null,

  addMessage: (message) =>
    set((state) => {
      const newMessages = [...state.messages, message];

      // If it's a CEO↔COO chat message, also add to chat
      const isCeoChat =
        message.type === "chat" &&
        (message.fromAgentId === null ||
          message.fromAgentId === "coo") &&
        (message.toAgentId === null || message.toAgentId === "coo");

      const newChat = isCeoChat
        ? [...state.chatMessages, message]
        : state.chatMessages;

      // Clear streaming if this is the final COO response
      const clearStream =
        message.fromAgentId === "coo" && message.toAgentId === null;

      return {
        messages: newMessages,
        chatMessages: newChat,
        ...(clearStream
          ? { streamingContent: "", streamingMessageId: null }
          : {}),
      };
    }),

  setCooResponse: (message) =>
    set((state) => ({
      streamingContent: "",
      streamingMessageId: null,
    })),

  appendCooStream: (token, messageId) =>
    set((state) => ({
      streamingContent:
        state.streamingMessageId === messageId
          ? state.streamingContent + token
          : token,
      streamingMessageId: messageId,
    })),

  setAgentFilter: (agentId) => set({ agentFilter: agentId }),

  loadHistory: (messages) =>
    set({
      messages,
      chatMessages: messages.filter(
        (m) =>
          m.type === "chat" &&
          (m.fromAgentId === null || m.fromAgentId === "coo") &&
          (m.toAgentId === null || m.toAgentId === "coo"),
      ),
    }),

  clearChat: () =>
    set({
      chatMessages: [],
      streamingContent: "",
      streamingMessageId: null,
    }),
}));
