import { create } from "zustand";
import type { OpenCodeSession, OpenCodeMessage, OpenCodePart, OpenCodeFileDiff } from "@otterbot/shared";

interface OpenCodeState {
  /** Active and recent sessions keyed by agentId */
  sessions: Map<string, OpenCodeSession>;
  /** Messages per session (keyed by sessionId) */
  messages: Map<string, OpenCodeMessage[]>;
  /** Accumulated deltas per partId for streaming display */
  partBuffers: Map<string, { type: string; content: string; toolName?: string; toolState?: string }>;
  /** File diffs per session */
  diffs: Map<string, OpenCodeFileDiff[]>;
  /** Currently selected agentId for viewing */
  selectedAgentId: string | null;
  /** Agents awaiting user input, keyed by agentId */
  awaitingInput: Map<string, { sessionId: string; prompt: string }>;

  selectAgent: (agentId: string | null) => void;
  setAwaitingInput: (agentId: string, data: { sessionId: string; prompt: string }) => void;
  clearAwaitingInput: (agentId: string) => void;
  startSession: (session: OpenCodeSession) => void;
  endSession: (agentId: string, sessionId: string, status: string, diff: OpenCodeFileDiff[] | null) => void;
  addMessage: (agentId: string, sessionId: string, message: OpenCodeMessage) => void;
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

export const useOpenCodeStore = create<OpenCodeState>((set) => ({
  sessions: new Map(),
  messages: new Map(),
  partBuffers: new Map(),
  diffs: new Map(),
  selectedAgentId: null,
  awaitingInput: new Map(),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

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
      const awaitingInput = new Map(state.awaitingInput);
      awaitingInput.delete(agentId);
      // Restore session status to active
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session && session.status === "awaiting-input") {
        sessions.set(agentId, { ...session, status: "active" });
      }
      return { awaitingInput, sessions };
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
          status: status as OpenCodeSession["status"],
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
      const sessions = new Map(state.sessions);
      const session = sessions.get(agentId);
      if (session && !session.id && sessionId) {
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
      return { sessions, messages, partBuffers, diffs, awaitingInput, selectedAgentId };
    }),
}));
