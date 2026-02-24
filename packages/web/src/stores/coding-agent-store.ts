import { create } from "zustand";
import type { CodingAgentSession, CodingAgentMessage, CodingAgentFileDiff, CodingAgentPermission } from "@otterbot/shared";

interface CodingAgentState {
  /** Active and recent sessions keyed by agentId */
  sessions: Map<string, CodingAgentSession>;
  /** Messages per session (keyed by sessionId) */
  messages: Map<string, CodingAgentMessage[]>;
  /** Accumulated deltas per partId for streaming display */
  partBuffers: Map<string, { type: string; content: string; toolName?: string; toolState?: string }>;
  /** File diffs per session */
  diffs: Map<string, CodingAgentFileDiff[]>;
  /** Currently selected agentId for viewing */
  selectedAgentId: string | null;
  /** Agents awaiting user input, keyed by agentId */
  awaitingInput: Map<string, { sessionId: string; prompt: string }>;
  /** Agents awaiting permission approval, keyed by agentId */
  pendingPermission: Map<string, { sessionId: string; permission: CodingAgentPermission }>;
  /** Whether more sessions are available from the server */
  hasMore: boolean;
  /** Whether a "load more" fetch is in progress */
  loadingMore: boolean;
  /** Set of dbIds currently being detail-fetched */
  detailLoading: Set<string>;

  selectAgent: (agentId: string | null) => void;
  setAwaitingInput: (agentId: string, data: { sessionId: string; prompt: string }) => void;
  clearAwaitingInput: (agentId: string) => void;
  setPendingPermission: (agentId: string, data: { sessionId: string; permission: CodingAgentPermission }) => void;
  clearPendingPermission: (agentId: string) => void;
  /** @deprecated Use loadSessionList instead */
  loadSessions: (data: {
    sessions: CodingAgentSession[];
    messages: Record<string, CodingAgentMessage[]>;
    diffs: Record<string, CodingAgentFileDiff[]>;
  }) => void;
  /** Load session metadata only (no messages/diffs) — used at startup */
  loadSessionList: (data: { sessions: CodingAgentSession[]; hasMore: boolean }) => void;
  /** Load next page of sessions using cursor pagination */
  loadMoreSessions: () => Promise<void>;
  /** Fetch session detail (messages + diffs) on demand */
  loadSessionDetail: (dbId: string, sessionId: string) => Promise<void>;
  /** Delete a single session from server and client */
  deleteSession: (dbId: string, agentId: string) => Promise<void>;
  /** Bulk delete all completed/error sessions */
  clearCompletedSessions: () => Promise<void>;
  startSession: (session: CodingAgentSession) => void;
  endSession: (agentId: string, sessionId: string, status: string, diff: CodingAgentFileDiff[] | null) => void;
  addMessage: (agentId: string, sessionId: string, message: CodingAgentMessage) => void;
  appendPartDelta: (
    agentId: string,
    sessionId: string,
    messageId: string,
    partId: string,
    type: string,
    delta: string,
    toolName?: string,
    toolState?: string,
  ) => void;
  clearSession: (agentId: string) => void;
}

export const useCodingAgentStore = create<CodingAgentState>((set, get) => ({
  sessions: new Map(),
  messages: new Map(),
  partBuffers: new Map(),
  diffs: new Map(),
  selectedAgentId: null,
  awaitingInput: new Map(),
  pendingPermission: new Map(),
  hasMore: false,
  loadingMore: false,
  detailLoading: new Set(),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  loadSessions: (data) =>
    set((state) => {
      let sessionsChanged = false;
      let messagesChanged = false;
      let diffsChanged = false;

      for (const s of data.sessions) {
        if (!state.sessions.has(s.agentId)) { sessionsChanged = true; break; }
      }
      for (const sid of Object.keys(data.messages)) {
        if (!state.messages.has(sid)) { messagesChanged = true; break; }
      }
      for (const sid of Object.keys(data.diffs)) {
        if (!state.diffs.has(sid)) { diffsChanged = true; break; }
      }

      if (!sessionsChanged && !messagesChanged && !diffsChanged) return state;

      const result: Partial<CodingAgentState> = {};
      if (sessionsChanged) {
        const sessions = new Map(state.sessions);
        for (const s of data.sessions) {
          if (!sessions.has(s.agentId)) sessions.set(s.agentId, s);
        }
        result.sessions = sessions;
      }
      if (messagesChanged) {
        const messages = new Map(state.messages);
        for (const [sid, msgs] of Object.entries(data.messages)) {
          if (!messages.has(sid)) messages.set(sid, msgs);
        }
        result.messages = messages;
      }
      if (diffsChanged) {
        const diffs = new Map(state.diffs);
        for (const [sid, d] of Object.entries(data.diffs)) {
          if (!diffs.has(sid)) diffs.set(sid, d);
        }
        result.diffs = diffs;
      }
      return result;
    }),

  loadSessionList: (data) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      for (const s of data.sessions) {
        if (!sessions.has(s.agentId)) sessions.set(s.agentId, s);
      }
      return { sessions, hasMore: data.hasMore };
    }),

  loadMoreSessions: async () => {
    const state = get();
    if (state.loadingMore || !state.hasMore) return;
    set({ loadingMore: true });
    try {
      // Find the oldest startedAt as cursor
      let oldest: string | undefined;
      for (const s of state.sessions.values()) {
        if (!oldest || s.startedAt < oldest) oldest = s.startedAt;
      }
      const params = new URLSearchParams({ limit: "20" });
      if (oldest) params.set("before", oldest);
      const res = await fetch(`/api/codeagent/sessions?${params}`);
      const data = await res.json() as { sessions: Array<{ id: string; sessionId: string; agentId: string; projectId: string | null; task: string; agentType?: string; status: string; startedAt: string; completedAt?: string }>; hasMore: boolean };
      const mapped: CodingAgentSession[] = data.sessions.map((s) => ({
        id: s.sessionId || s.id,
        dbId: s.id,
        agentId: s.agentId,
        projectId: s.projectId,
        task: s.task,
        agentType: (s.agentType || "opencode") as CodingAgentSession["agentType"],
        status: s.status as CodingAgentSession["status"],
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      }));
      set((prev) => {
        const sessions = new Map(prev.sessions);
        for (const s of mapped) {
          if (!sessions.has(s.agentId)) sessions.set(s.agentId, s);
        }
        return { sessions, hasMore: data.hasMore, loadingMore: false };
      });
    } catch {
      set({ loadingMore: false });
    }
  },

  loadSessionDetail: async (dbId, sessionId) => {
    const state = get();
    // Skip if already loaded or currently loading
    if (state.messages.has(sessionId) || state.detailLoading.has(dbId)) return;
    set((prev) => ({ detailLoading: new Set(prev.detailLoading).add(dbId) }));
    try {
      const res = await fetch(`/api/codeagent/sessions/${dbId}`);
      const detail = await res.json() as { messages: CodingAgentMessage[]; diffs: CodingAgentFileDiff[] };
      set((prev) => {
        const messages = new Map(prev.messages);
        messages.set(sessionId, detail.messages ?? []);
        const diffs = new Map(prev.diffs);
        diffs.set(sessionId, detail.diffs ?? []);
        const detailLoading = new Set(prev.detailLoading);
        detailLoading.delete(dbId);
        return { messages, diffs, detailLoading };
      });
    } catch {
      set((prev) => {
        const detailLoading = new Set(prev.detailLoading);
        detailLoading.delete(dbId);
        return { detailLoading };
      });
    }
  },

  deleteSession: async (dbId, agentId) => {
    try {
      await fetch(`/api/codeagent/sessions/${dbId}`, { method: "DELETE" });
      get().clearSession(agentId);
    } catch {
      // ignore
    }
  },

  clearCompletedSessions: async () => {
    try {
      await fetch("/api/codeagent/sessions", { method: "DELETE" });
      set((state) => {
        const sessions = new Map(state.sessions);
        const messages = new Map(state.messages);
        const diffs = new Map(state.diffs);
        const partBuffers = new Map(state.partBuffers);
        for (const [agentId, session] of state.sessions) {
          if (session.status === "completed" || session.status === "error") {
            sessions.delete(agentId);
            messages.delete(session.id);
            diffs.delete(session.id);
            for (const key of partBuffers.keys()) {
              if (key.startsWith(`${session.id}:`)) partBuffers.delete(key);
            }
          }
        }
        const selectedAgentId = sessions.has(state.selectedAgentId ?? "") ? state.selectedAgentId : null;
        return { sessions, messages, diffs, partBuffers, selectedAgentId };
      });
    } catch {
      // ignore
    }
  },

  setAwaitingInput: (agentId, data) =>
    set((state) => {
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.set(agentId, data);
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session) {
        sessions.set(agentId, { ...session, status: "awaiting-input" });
      }
      return { awaitingInput, sessions };
    }),

  clearAwaitingInput: (agentId) =>
    set((state) => {
      if (!state.awaitingInput.has(agentId)) return state;
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.delete(agentId);
      const session = state.sessions.get(agentId);
      if (session && session.status === "awaiting-input") {
        const sessions = new Map(state.sessions);
        sessions.set(agentId, { ...session, status: "active" });
        return { awaitingInput, sessions };
      }
      return { awaitingInput };
    }),

  setPendingPermission: (agentId, data) =>
    set((state) => {
      const pendingPermission = new Map(state.pendingPermission);
      pendingPermission.set(agentId, data);
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session) {
        sessions.set(agentId, { ...session, status: "awaiting-permission" as CodingAgentSession["status"] });
      }
      return { pendingPermission, sessions };
    }),

  clearPendingPermission: (agentId) =>
    set((state) => {
      if (!state.pendingPermission.has(agentId)) return state;
      const pendingPermission = new Map(state.pendingPermission);
      pendingPermission.delete(agentId);
      const session = state.sessions.get(agentId);
      if (session && (session.status as string) === "awaiting-permission") {
        const sessions = new Map(state.sessions);
        sessions.set(agentId, { ...session, status: "active" });
        return { pendingPermission, sessions };
      }
      return { pendingPermission };
    }),

  startSession: (session) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(session.agentId, session);
      const selectedAgentId = state.selectedAgentId ?? session.agentId;
      return { sessions, selectedAgentId };
    }),

  endSession: (agentId, sessionId, status, diff) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(agentId);
      if (existing) {
        sessions.set(agentId, {
          ...existing,
          id: sessionId || existing.id,
          status: status as CodingAgentSession["status"],
          completedAt: new Date().toISOString(),
        });
      }
      const diffs = new Map(state.diffs);
      if (diff) {
        diffs.set(sessionId || existing?.id || "", diff);
      }
      return { sessions, diffs };
    }),

  addMessage: (agentId, sessionId, message) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session && !session.id && sessionId) {
        sessions.set(agentId, { ...session, id: sessionId });
      }

      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) ?? [];
      const idx = existing.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const updated = [...existing];
        updated[idx] = message;
        messages.set(sessionId, updated);
      } else {
        messages.set(sessionId, [...existing, message]);
      }
      return { sessions, messages };
    }),

  appendPartDelta: (agentId, sessionId, messageId, partId, type, delta, toolName, toolState) =>
    set((state) => {
      const session = state.sessions.get(agentId);
      const needsSessionUpdate = session && !session.id && sessionId;
      const sessions = needsSessionUpdate ? new Map(state.sessions) : state.sessions;
      if (needsSessionUpdate) {
        sessions.set(agentId, { ...session, id: sessionId });
      }

      const partBuffers = new Map(state.partBuffers);
      const key = `${sessionId}:${messageId}:${partId}`;
      const existing = partBuffers.get(key);
      partBuffers.set(key, {
        type,
        content: (existing?.content ?? "") + delta,
        toolName: toolName ?? existing?.toolName,
        toolState: toolState ?? existing?.toolState,
      });
      return { sessions, partBuffers };
    }),

  clearSession: (agentId) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      sessions.delete(agentId);
      const messages = new Map(state.messages);
      const partBuffers = new Map(state.partBuffers);
      const diffs = new Map(state.diffs);
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.delete(agentId);
      const pendingPermission = new Map(state.pendingPermission);
      pendingPermission.delete(agentId);
      if (session) {
        messages.delete(session.id);
        diffs.delete(session.id);
        for (const key of partBuffers.keys()) {
          if (key.startsWith(`${session.id}:`)) {
            partBuffers.delete(key);
          }
        }
      }
      const selectedAgentId = state.selectedAgentId === agentId ? null : state.selectedAgentId;
      return { sessions, messages, partBuffers, diffs, awaitingInput, pendingPermission, selectedAgentId };
    }),
}));

/** @deprecated Use useCodingAgentStore instead */
export const useOpenCodeStore = useCodingAgentStore;
