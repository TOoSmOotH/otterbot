import { create } from "zustand";
import { getSocket } from "../lib/socket";
import type { AgentProfile, AgentProfileSummary, AgentStatus } from "@otterbot/shared";

/** Payload accepted by the create-agent endpoint. */
export type CreateAgentInput = Partial<Omit<AgentProfile, "id" | "createdAt">> & {
  displayName: string;
};

interface AgentsState {
  agents: AgentProfileSummary[];
  activeAgentId: string | null;
  loading: boolean;
  socketBound: boolean;

  load: () => Promise<void>;
  bindSocket: () => void;
  setActive: (id: string) => void;
  create: (input: CreateAgentInput) => Promise<AgentProfileSummary | null>;
  update: (id: string, patch: Partial<AgentProfile>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  activeAgentId: null,
  loading: false,
  socketBound: false,

  load: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) return;
      const agents = (await res.json()) as AgentProfileSummary[];
      set((s) => ({
        agents,
        activeAgentId:
          s.activeAgentId && agents.some((a) => a.id === s.activeAgentId)
            ? s.activeAgentId
            : (agents.find((a) => a.role === "coo") ?? agents[0])?.id ?? null,
      }));
    } finally {
      set({ loading: false });
    }
  },

  bindSocket: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    getSocket().on("agent:status", (p: { agentId: string; status: AgentStatus }) => {
      set((s) => ({
        agents: s.agents.map((a) => (a.id === p.agentId ? { ...a, status: p.status } : a)),
      }));
    });
  },

  setActive: (id) => set({ activeAgentId: id }),

  create: async (input) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    await get().load();
    const created = (await res.json()) as AgentProfile;
    set({ activeAgentId: created.id });
    return get().agents.find((a) => a.id === created.id) ?? null;
  },

  update: async (id, patch) => {
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) await get().load();
  },

  remove: async (id) => {
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (res.ok) {
      set((s) => ({
        activeAgentId: s.activeAgentId === id ? null : s.activeAgentId,
      }));
      await get().load();
    }
  },
}));
