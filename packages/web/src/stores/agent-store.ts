import { create } from "zustand";
import type { Agent, AgentStatus } from "@smoothbot/shared";

interface AgentState {
  agents: Map<string, Agent>;
  /** IDs of agents removed via socket events — prevents stale API data re-adding them */
  _removedIds: Set<string>;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  removeAgent: (agentId: string) => void;
  loadAgents: (agents: Agent[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: new Map(),
  _removedIds: new Set(),

  addAgent: (agent) =>
    set((state) => {
      if (state._removedIds.has(agent.id)) return state;
      const next = new Map(state.agents);
      next.set(agent.id, agent);
      return { agents: next };
    }),

  updateAgentStatus: (agentId, status) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;
      const next = new Map(state.agents);
      if (status === "done") {
        next.delete(agentId);
        const removed = new Set(state._removedIds);
        removed.add(agentId);
        return { agents: next, _removedIds: removed };
      }
      next.set(agentId, { ...agent, status });
      return { agents: next };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const next = new Map(state.agents);
      next.delete(agentId);
      const removed = new Set(state._removedIds);
      removed.add(agentId);
      return { agents: next, _removedIds: removed };
    }),

  loadAgents: (agents) =>
    set((state) => ({
      agents: new Map(
        agents
          .filter((a) => a.status !== "done" && !state._removedIds.has(a.id))
          .map((a) => [a.id, a]),
      ),
    })),
}));
