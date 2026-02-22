import { create } from "zustand";
import type { CodingAgentSession, CodingAgentMessage, CodingAgentPart, CodingAgentFileDiff, CodingAgentPermission } from "@otterbot/shared";

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

  selectAgent: (agentId: string | null) => void;
  setAwaitingInput: (agentId: string, data: { sessionId: string; prompt: string }) => void;
  clearAwaitingInput: (agentId: string) => void;
  setPendingPermission: (agentId: string, data: { sessionId: string; permission: CodingAgentPermission }) => void;
  clearPendingPermission: (agentId: string) => void;
  loadSessions: (data: {
    sessions: CodingAgentSession[];
    messages: Record<string, CodingAgentMessage[]>;
    diffs: Record<string, CodingAgentFileDiff[]>;
  }) => void;
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

export const useCodingAgentStore = create<CodingAgentState>((set) => ({
  sessions: new Map(),
  messages: new Map(),
  partBuffers: new Map(),
  diffs: new Map(),
  selectedAgentId: null,
  awaitingInput: new Map(),
  pendingPermission: new Map(),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  loadSessions: (data) =>
    set((state) => {
      // Only create new Maps if we actually add something, to avoid unnecessary re-renders
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

  setAwaitingInput: (agentId, data) =>
    set((state) => {
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.set(agentId, data);
      // Update session status to awaiting-input
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session) {
        sessions.set(agentId, { ...session, status: "awaiting-input" });
      }
      return { awaitingInput, sessions };
    }),

  clearAwaitingInput: (agentId) =>
    set((state) => {
      if (!state.awaitingInput.has(agentId)) return state; // no-op
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.delete(agentId);
      // Restore session status to active
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
      // Update session status to awaiting-permission
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
      // Restore session status to active
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
      // Auto-select the first active session
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
      // Update the session's ID if it was empty
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session && !session.id && sessionId) {
        sessions.set(agentId, { ...session, id: sessionId });
      }

      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) ?? [];
      // Replace if message ID already exists, otherwise append
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
      // Update the session's ID if it was empty (started before session was created)
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
        // Clean up part buffers for this session
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
