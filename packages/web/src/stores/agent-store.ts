import { create } from "zustand";
import type { Agent, AgentStatus } from "@smoothbot/shared";

interface AgentState {
  agents: Map<string, Agent>;
  addAgent: (agent: Agent) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  removeAgent: (agentId: string) => void;
  loadAgents: (agents: Agent[]) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: new Map(),

  addAgent: (agent) =>
    set((state) => {
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
        // Remove finished agents entirely so the graph drops them immediately
        next.delete(agentId);
      } else {
        next.set(agentId, { ...agent, status });
      }
      return { agents: next };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const next = new Map(state.agents);
      next.delete(agentId);
      return { agents: next };
    }),

  loadAgents: (agents) =>
    set({
      agents: new Map(agents.map((a) => [a.id, a])),
    }),
}));
