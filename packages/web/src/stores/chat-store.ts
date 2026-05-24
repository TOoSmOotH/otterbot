import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { getSocket } from "../lib/socket";
import type {
  Artifact,
  StreamChunk,
  ConversationSummary,
  ContextStatus,
  ChatMessage as StoredMessage,
  ToolCallRecord,
} from "@otterbot/shared";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  /** A generated/shared image to render inline (from an image tool result). */
  imageUrl?: string;
  /** A non-image file to offer as a download (from a file tool result). */
  fileUrl?: string;
  fileName?: string;
  /** Files the user uploaded with this message. */
  attachments?: Artifact[];
  pending?: boolean;
  error?: string;
}

/** The display fields a tool result contributes (an image or a download). */
type ArtifactFields = Pick<ChatMessage, "imageUrl" | "fileUrl" | "fileName">;

/**
 * Pull display fields out of a tool result like `{ kind: "image", url }` or
 * `{ kind: "file", url, name }`. Anything with a `url` but no explicit `file`
 * kind is treated as an image (back-compat with existing image results).
 */
function artifactFromResult(result: unknown): ArtifactFields | undefined {
  if (!result || typeof result !== "object" || !("url" in result)) return undefined;
  const r = result as { kind?: unknown; url?: unknown; name?: unknown };
  if (typeof r.url !== "string") return undefined;
  if (r.kind === "file") {
    return { fileUrl: r.url, fileName: typeof r.name === "string" ? r.name : "file" };
  }
  return { imageUrl: r.url };
}

function artifactFromToolCalls(calls?: ToolCallRecord[]): ArtifactFields | undefined {
  for (const c of calls ?? []) {
    const fields = artifactFromResult(c.result);
    if (fields) return fields;
  }
  return undefined;
}

interface ChatState {
  connected: boolean;
  /** Message history per agent id. */
  byAgent: Record<string, ChatMessage[]>;
  /** Whether each agent is currently streaming a response. */
  streaming: Record<string, boolean>;
  /** The conversation id the socket is currently joined to, per agent. */
  currentConversation: Record<string, string | null>;
  /** Browsable past conversations per agent. */
  conversations: Record<string, ConversationSummary[]>;
  /** Context-budget accounting for each agent's current conversation. */
  contextStatus: Record<string, ContextStatus | null>;
  /** Whether a past conversation is being loaded over HTTP, per agent. */
  historyLoading: Record<string, boolean>;
  socketBound: boolean;

  connect: () => void;
  join: (agentId: string) => void;
  send: (agentId: string, text: string, attachments?: Artifact[]) => void;
  loadConversations: (agentId: string) => Promise<void>;
  openConversation: (agentId: string, conversationId: string) => Promise<void>;
  newConversation: (agentId: string) => void;
  refreshContext: (agentId: string) => Promise<void>;
  compact: (agentId: string, force?: boolean) => Promise<void>;
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
    case "tool_end": {
      const fields = artifactFromResult(chunk.result);
      if (!fields) return next;
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].id === `t-${chunk.id}`) {
          next[i] = { ...next[i], ...fields };
          break;
        }
      }
      return next;
    }
    case "artifacts": {
      // Files a delegated peer produced — shown as their own tool bubbles.
      for (const a of chunk.artifacts) {
        next.push({
          id: `art-${a.id}-${next.length}`,
          role: "tool",
          content: a.kind === "image" ? a.prompt ?? a.name : a.name,
          imageUrl: a.kind === "image" ? a.url : undefined,
          fileUrl: a.kind === "file" ? a.url : undefined,
          fileName: a.kind === "file" ? a.name : undefined,
        });
      }
      return next;
    }
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
  currentConversation: {},
  conversations: {},
  contextStatus: {},
  historyLoading: {},
  socketBound: false,

  connect: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    const socket = getSocket();

    socket.on("connect", () => set({ connected: true }));
    socket.on("disconnect", () => set({ connected: false }));
    if (socket.connected) set({ connected: true });

    // The server tells us which conversation we are joined to — track it so
    // history and context calls target the right conversation.
    socket.on("chat:joined", (payload: { agentId: string; conversationId: string }) => {
      set((state) => ({
        currentConversation: {
          ...state.currentConversation,
          [payload.agentId]: payload.conversationId,
        },
      }));
    });

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
      // Token usage and the conversation list (title/updatedAt) changed.
      void get().refreshContext(payload.agentId);
      void get().loadConversations(payload.agentId);
    });
  },

  join: (agentId) => {
    const conversationId = get().currentConversation[agentId] ?? undefined;
    getSocket().emit("chat:join", { agentId, conversationId });
  },

  send: (agentId, text, attachments) => {
    const trimmed = text.trim();
    if (!trimmed && !attachments?.length) return;
    set((state) => ({
      byAgent: {
        ...state.byAgent,
        [agentId]: [
          ...(state.byAgent[agentId] ?? []),
          { id: `u-${Date.now()}`, role: "user", content: trimmed, attachments },
        ],
      },
      streaming: { ...state.streaming, [agentId]: true },
    }));
    getSocket().emit("chat:message", { agentId, text: trimmed, attachments });
  },

  loadConversations: async (agentId) => {
    try {
      const res = await apiFetch(`/api/agents/${agentId}/conversations`);
      if (!res.ok) return;
      const list = (await res.json()) as ConversationSummary[];
      set((state) => ({ conversations: { ...state.conversations, [agentId]: list } }));
    } catch {
      /* offline — keep the last list */
    }
  },

  openConversation: async (agentId, conversationId) => {
    set((state) => ({ historyLoading: { ...state.historyLoading, [agentId]: true } }));
    try {
      const res = await apiFetch(`/api/agents/${agentId}/conversations/${conversationId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: StoredMessage[] };
      const mapped: ChatMessage[] = data.messages.map((m) => {
        const role = m.role === "assistant" || m.role === "tool" ? m.role : "user";
        return {
          id: m.id,
          role,
          content: m.content,
          attachments: m.attachments,
          ...(role === "tool" ? artifactFromToolCalls(m.toolCalls) : undefined),
        };
      });
      set((state) => ({
        byAgent: { ...state.byAgent, [agentId]: mapped },
        currentConversation: { ...state.currentConversation, [agentId]: conversationId },
        streaming: { ...state.streaming, [agentId]: false },
      }));
      // Join the socket to this conversation so further messages resume it.
      getSocket().emit("chat:join", { agentId, conversationId });
      await get().refreshContext(agentId);
    } finally {
      set((state) => ({ historyLoading: { ...state.historyLoading, [agentId]: false } }));
    }
  },

  newConversation: (agentId) => {
    getSocket().emit("chat:close", { agentId });
    set((state) => ({
      byAgent: { ...state.byAgent, [agentId]: [] },
      streaming: { ...state.streaming, [agentId]: false },
      currentConversation: { ...state.currentConversation, [agentId]: null },
      contextStatus: { ...state.contextStatus, [agentId]: null },
    }));
    // Re-join with no id — the server mints a fresh conversation.
    getSocket().emit("chat:join", { agentId });
  },

  refreshContext: async (agentId) => {
    const conversationId = get().currentConversation[agentId];
    if (!conversationId) return;
    try {
      const res = await apiFetch(
        `/api/agents/${agentId}/conversations/${conversationId}/context`
      );
      if (!res.ok) return;
      const status = (await res.json()) as ContextStatus;
      set((state) => ({ contextStatus: { ...state.contextStatus, [agentId]: status } }));
    } catch {
      /* offline */
    }
  },

  compact: async (agentId, force = true) => {
    const conversationId = get().currentConversation[agentId];
    if (!conversationId) return;
    const res = await apiFetch(
      `/api/agents/${agentId}/conversations/${conversationId}/compact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      }
    );
    if (!res.ok) return;
    const status = (await res.json()) as ContextStatus;
    set((state) => ({ contextStatus: { ...state.contextStatus, [agentId]: status } }));
  },
}));
