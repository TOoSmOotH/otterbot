import { create } from "zustand";
import type { BusMessage, Conversation } from "@smoothbot/shared";

interface MessageState {
  /** All bus messages (for the stream panel) */
  messages: BusMessage[];
  /** Whether there are older messages on the server */
  hasMore: boolean;
  /** Chat messages between CEO and COO */
  chatMessages: BusMessage[];
  /** Current streaming token buffer */
  streamingContent: string;
  streamingMessageId: string | null;
  /** Thinking state */
  thinkingContent: string;
  thinkingMessageId: string | null;
  isThinking: boolean;
  /** Filter for stream panel */
  agentFilter: string | null;
  /** Conversation tracking */
  currentConversationId: string | null;
  conversations: Conversation[];

  addMessage: (message: BusMessage) => void;
  setCooResponse: (message: BusMessage) => void;
  appendCooStream: (token: string, messageId: string) => void;
  appendCooThinking: (token: string, messageId: string) => void;
  endCooThinking: (messageId: string) => void;
  setAgentFilter: (agentId: string | null) => void;
  loadHistory: (data: { messages: BusMessage[]; hasMore: boolean }) => void;
  prependHistory: (data: { messages: BusMessage[]; hasMore: boolean }) => void;
  clearChat: () => void;
  setCurrentConversation: (id: string | null) => void;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  loadConversationMessages: (messages: BusMessage[]) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  hasMore: true,
  chatMessages: [],
  streamingContent: "",
  streamingMessageId: null,
  thinkingContent: "",
  thinkingMessageId: null,
  isThinking: false,
  agentFilter: null,
  currentConversationId: null,
  conversations: [],

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
          ? {
              streamingContent: "",
              streamingMessageId: null,
              thinkingContent: "",
              thinkingMessageId: null,
              isThinking: false,
            }
          : {}),
      };
    }),

  setCooResponse: (_message) =>
    set({
      streamingContent: "",
      streamingMessageId: null,
      thinkingContent: "",
      thinkingMessageId: null,
      isThinking: false,
    }),

  appendCooStream: (token, messageId) =>
    set((state) => ({
      streamingContent:
        state.streamingMessageId === messageId
          ? state.streamingContent + token
          : token,
      streamingMessageId: messageId,
    })),

  appendCooThinking: (token, messageId) =>
    set((state) => ({
      thinkingContent:
        state.thinkingMessageId === messageId
          ? state.thinkingContent + token
          : token,
      thinkingMessageId: messageId,
      isThinking: true,
    })),

  endCooThinking: (_messageId) =>
    set({
      isThinking: false,
    }),

  setAgentFilter: (agentId) => set({ agentFilter: agentId }),

  loadHistory: ({ messages, hasMore }) =>
    set({
      messages,
      hasMore,
      chatMessages: messages.filter(
        (m) =>
          m.type === "chat" &&
          (m.fromAgentId === null || m.fromAgentId === "coo") &&
          (m.toAgentId === null || m.toAgentId === "coo"),
      ),
    }),

  prependHistory: ({ messages: older, hasMore }) =>
    set((state) => {
      const merged = [...older, ...state.messages];
      return {
        messages: merged,
        hasMore,
        chatMessages: merged.filter(
          (m) =>
            m.type === "chat" &&
            (m.fromAgentId === null || m.fromAgentId === "coo") &&
            (m.toAgentId === null || m.toAgentId === "coo"),
        ),
      };
    }),

  clearChat: () =>
    set({
      chatMessages: [],
      streamingContent: "",
      streamingMessageId: null,
      thinkingContent: "",
      thinkingMessageId: null,
      isThinking: false,
      currentConversationId: null,
    }),

  setCurrentConversation: (id) =>
    set({ currentConversationId: id }),

  setConversations: (conversations) =>
    set({ conversations }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  loadConversationMessages: (messages) =>
    set({
      chatMessages: messages.filter(
        (m) =>
          m.type === "chat" &&
          (m.fromAgentId === null || m.fromAgentId === "coo") &&
          (m.toAgentId === null || m.toAgentId === "coo"),
      ),
      streamingContent: "",
      streamingMessageId: null,
      thinkingContent: "",
      thinkingMessageId: null,
      isThinking: false,
    }),
}));
