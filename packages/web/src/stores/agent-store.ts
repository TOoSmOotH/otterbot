import { create } from "zustand";
import type { Agent, AgentStatus } from "@otterbot/shared";

interface AgentState {
  agents: Map<string, Agent>;
  /** IDs of agents removed via socket events — prevents stale API data re-adding them */
  _removedIds: Set<string>;
  /** IDs of agents walking to center before exploding */
  _departingIds: Set<string>;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  removeAgent: (agentId: string) => void;
  loadAgents: (agents: Agent[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: new Map(),
  _removedIds: new Set(),
  _departingIds: new Set(),

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
        // Keep the agent in the map so it continues rendering while walking to center.
        // Mark as departing — movement-triggers will walk it to center,
        // then the departure watcher will trigger the explosion on arrival.
        next.set(agentId, { ...agent, status });
        const departing = new Set(state._departingIds);
        departing.add(agentId);
        return { agents: next, _departingIds: departing };
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
      const departing = new Set(state._departingIds);
      departing.delete(agentId);
      return { agents: next, _removedIds: removed, _departingIds: departing };
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
