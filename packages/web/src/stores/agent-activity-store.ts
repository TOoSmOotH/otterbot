import { create } from "zustand";
import type { BusMessage, AgentActivityRecord } from "@otterbot/shared";

interface AgentStreamState {
  tokens: string;
  thinking: string;
  isThinking: boolean;
}

interface AgentToolCallEntry {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: string;
}

interface AgentActivityState {
  selectedAgentId: string | null;
  agentStreams: Map<string, AgentStreamState>;
  agentToolCalls: Map<string, AgentToolCallEntry[]>;
  agentMessages: Map<string, BusMessage[]>;
  agentActivity: Map<string, AgentActivityRecord[]>;

  selectAgent: (id: string) => void;
  clearSelection: () => void;
  appendStream: (agentId: string, token: string, messageId: string) => void;
  appendThinking: (agentId: string, token: string, messageId: string) => void;
  endThinking: (agentId: string, messageId: string) => void;
  addToolCall: (agentId: string, toolName: string, args: Record<string, unknown>) => void;
  loadAgentActivity: (agentId: string, data: { messages: BusMessage[]; activity: AgentActivityRecord[] }) => void;
}

export const useAgentActivityStore = create<AgentActivityState>((set) => ({
  selectedAgentId: null,
  agentStreams: new Map(),
  agentToolCalls: new Map(),
  agentMessages: new Map(),
  agentActivity: new Map(),

  selectAgent: (id) => set({ selectedAgentId: id }),

  clearSelection: () => set({ selectedAgentId: null }),

  appendStream: (agentId, token, _messageId) =>
    set((state) => {
      const streams = new Map(state.agentStreams);
      const current = streams.get(agentId) ?? { tokens: "", thinking: "", isThinking: false };
      streams.set(agentId, { ...current, tokens: current.tokens + token });
      return { agentStreams: streams };
    }),

  appendThinking: (agentId, token, _messageId) =>
    set((state) => {
      const streams = new Map(state.agentStreams);
      const current = streams.get(agentId) ?? { tokens: "", thinking: "", isThinking: false };
      streams.set(agentId, { ...current, thinking: current.thinking + token, isThinking: true });
      return { agentStreams: streams };
    }),

  endThinking: (agentId, _messageId) =>
    set((state) => {
      const streams = new Map(state.agentStreams);
      const current = streams.get(agentId);
      if (current) {
        streams.set(agentId, { ...current, isThinking: false });
      }
      return { agentStreams: streams };
    }),

  addToolCall: (agentId, toolName, args) =>
    set((state) => {
      const calls = new Map(state.agentToolCalls);
      const existing = calls.get(agentId) ?? [];
      calls.set(agentId, [...existing, { toolName, args, timestamp: new Date().toISOString() }]);
      return { agentToolCalls: calls };
    }),

  loadAgentActivity: (agentId, data) =>
    set((state) => {
      const messages = new Map(state.agentMessages);
      messages.set(agentId, data.messages);
      const activity = new Map(state.agentActivity);
      activity.set(agentId, data.activity);

      // Also populate tool calls from persisted activity records
      const calls = new Map(state.agentToolCalls);
      const existingCalls = calls.get(agentId) ?? [];
      const persistedCalls = data.activity
        .filter((a) => a.type === "tool_call")
        .map((a) => ({
          toolName: (a.metadata?.toolName as string) ?? "unknown",
          args: (a.metadata?.args as Record<string, unknown>) ?? {},
          timestamp: a.timestamp,
        }));
      // Merge: keep live calls that came after the latest persisted timestamp
      const latestPersisted = persistedCalls.length > 0
        ? persistedCalls[persistedCalls.length - 1].timestamp
        : "";
      const newLiveCalls = existingCalls.filter((c) => c.timestamp > latestPersisted);
      calls.set(agentId, [...persistedCalls, ...newLiveCalls]);

      return { agentMessages: messages, agentActivity: activity, agentToolCalls: calls };
    }),
}));
