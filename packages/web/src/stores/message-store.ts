import { create } from "zustand";
import type { BusMessage, Conversation, ConversationContextSize } from "@otterbot/shared";
import {
  EMPTY_CONTEXT_SIZE,
  estimateConversationContextSize,
  isCeoChatMessage,
} from "../lib/estimate-context-size";

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
  streamingConversationId: string | null;
  /** Thinking state */
  thinkingContent: string;
  thinkingMessageId: string | null;
  isThinking: boolean;
  /** Filter for stream panel */
  agentFilter: string | null;
  /** Conversation tracking */
  currentConversationId: string | null;
  conversations: Conversation[];
  conversationContextSizes: Record<string, ConversationContextSize>;
  currentConversationContextSize: ConversationContextSize;

  addMessage: (message: BusMessage) => void;
  setCooResponse: (message: BusMessage) => void;
  appendCooStream: (token: string, messageId: string, conversationId: string | null) => void;
  appendCooThinking: (token: string, messageId: string, conversationId: string | null) => void;
  endCooThinking: (messageId: string, conversationId: string | null) => void;
  setAgentFilter: (agentId: string | null) => void;
  loadHistory: (data: { messages: BusMessage[]; hasMore: boolean }) => void;
  prependHistory: (data: { messages: BusMessage[]; hasMore: boolean }) => void;
  clearChat: () => void;
  setCurrentConversation: (id: string | null) => void;
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  setConversationContextSize: (conversationId: string, contextSize: ConversationContextSize) => void;
  loadConversationMessages: (messages: BusMessage[], contextSize?: ConversationContextSize, conversationId?: string | null) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  hasMore: true,
  chatMessages: [],
  streamingContent: "",
  streamingMessageId: null,
  streamingConversationId: null,
  thinkingContent: "",
  thinkingMessageId: null,
  isThinking: false,
  agentFilter: null,
  currentConversationId: null,
  conversations: [],
  conversationContextSizes: {},
  currentConversationContextSize: EMPTY_CONTEXT_SIZE,

  addMessage: (message) =>
    set((state) => {
      const newMessages = [...state.messages, message];
      const updatedChatMessages = isCeoChatMessage(message)
        ? [...state.chatMessages, message]
        : state.chatMessages;

      const targetConversationId = message.conversationId ?? state.currentConversationId;
      const shouldTrackContext = targetConversationId ? isCeoChatMessage(message) : false;
      const nextContextSizeByConversationId = shouldTrackContext
        ? {
            ...state.conversationContextSizes,
            [targetConversationId]: estimateConversationContextSize(
              newMessages.filter(
                (entry) =>
                  isCeoChatMessage(entry) && (entry.conversationId ?? null) === targetConversationId,
              ),
            ),
          }
        : state.conversationContextSizes;
      const nextCurrentContextSize = shouldTrackContext
        ? targetConversationId === state.currentConversationId
          ? nextContextSizeByConversationId[targetConversationId]
          : state.currentConversationContextSize
        : state.currentConversationContextSize;

      // Clear streaming if this is the final agent response for the current conversation
      const clearStream =
        (message.fromAgentId === "coo" || message.fromAgentId?.startsWith("module-agent-")) &&
        message.toAgentId === null &&
        (!message.conversationId || message.conversationId === state.currentConversationId);

      return {
        messages: newMessages,
        chatMessages: updatedChatMessages,
        conversationContextSizes: nextContextSizeByConversationId,
        currentConversationContextSize: nextCurrentContextSize,
        ...(clearStream
          ? {
              streamingContent: "",
              streamingMessageId: null,
              streamingConversationId: null,
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

  appendCooStream: (token, messageId, conversationId) =>
    set((state) => {
      // Ignore tokens for a different conversation
      if (conversationId && conversationId !== state.currentConversationId) {
        return state;
      }
      return {
        streamingContent:
          state.streamingMessageId === messageId
            ? state.streamingContent + token
            : token,
        streamingMessageId: messageId,
        streamingConversationId: conversationId,
      };
    }),

  appendCooThinking: (token, messageId, conversationId) =>
    set((state) => {
      // Ignore tokens for a different conversation
      if (conversationId && conversationId !== state.currentConversationId) {
        return state;
      }
      return {
        thinkingContent:
          state.thinkingMessageId === messageId
            ? state.thinkingContent + token
            : token,
        thinkingMessageId: messageId,
        isThinking: true,
      };
    }),

  endCooThinking: (_messageId, conversationId) =>
    set((state) => {
      // Ignore if for a different conversation
      if (conversationId && conversationId !== state.currentConversationId) {
        return state;
      }
      return { isThinking: false };
    }),

  setAgentFilter: (agentId) => set({ agentFilter: agentId }),

  loadHistory: ({ messages, hasMore }) =>
    set({
      messages,
      hasMore,
      chatMessages: messages.filter(isCeoChatMessage),
    }),

  prependHistory: ({ messages: older, hasMore }) =>
    set((state) => {
      const merged = [...older, ...state.messages];
      return {
        messages: merged,
        hasMore,
        chatMessages: merged.filter(isCeoChatMessage),
      };
    }),

  clearChat: () =>
    set({
      chatMessages: [],
      streamingContent: "",
      streamingMessageId: null,
      streamingConversationId: null,
      thinkingContent: "",
      thinkingMessageId: null,
      isThinking: false,
      currentConversationId: null,
      currentConversationContextSize: EMPTY_CONTEXT_SIZE,
    }),

  setCurrentConversation: (id) =>
    set((state) => ({
      currentConversationId: id,
      currentConversationContextSize: id
        ? state.conversationContextSizes[id] ?? EMPTY_CONTEXT_SIZE
        : EMPTY_CONTEXT_SIZE,
    })),

  setConversations: (conversations) =>
    set({ conversations }),

  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  setConversationContextSize: (conversationId, contextSize) =>
    set((state) => {
      const nextContextSizes = {
        ...state.conversationContextSizes,
        [conversationId]: contextSize,
      };
      return {
        conversationContextSizes: nextContextSizes,
        ...(state.currentConversationId === conversationId
          ? { currentConversationContextSize: contextSize }
          : {}),
      };
    }),

  loadConversationMessages: (messages, contextSize, conversationId) =>
    set((state) => {
      const targetConversationId = conversationId ?? state.currentConversationId;
      const resolvedContextSize = contextSize ?? estimateConversationContextSize(messages);
      const nextContextSizes = targetConversationId
        ? {
            ...state.conversationContextSizes,
            [targetConversationId]: resolvedContextSize,
          }
        : state.conversationContextSizes;
      return {
        chatMessages: messages.filter(isCeoChatMessage),
        streamingContent: "",
        streamingMessageId: null,
        streamingConversationId: null,
        thinkingContent: "",
        thinkingMessageId: null,
        isThinking: false,
        conversationContextSizes: nextContextSizes,
        currentConversationContextSize:
          targetConversationId && state.currentConversationId === targetConversationId
            ? resolvedContextSize
            : state.currentConversationContextSize,
      };
    }),
}));
