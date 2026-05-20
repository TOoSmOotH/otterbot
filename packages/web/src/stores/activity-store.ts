import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { getSocket } from "../lib/socket";
import type { AgentMessage, SubagentTask } from "@otterbot/shared";

interface ActivityState {
  messages: AgentMessage[];
  tasks: SubagentTask[];
  socketBound: boolean;

  load: () => Promise<void>;
  loadTasks: () => Promise<void>;
  bindSocket: () => void;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  messages: [],
  tasks: [],
  socketBound: false,

  load: async () => {
    try {
      const res = await apiFetch("/api/bus/messages?limit=300");
      if (res.ok) set({ messages: (await res.json()) as AgentMessage[] });
    } catch {
      // ignore
    }
    await get().loadTasks();
  },

  loadTasks: async () => {
    try {
      const res = await apiFetch("/api/subagent-tasks");
      if (res.ok) set({ tasks: (await res.json()) as SubagentTask[] });
    } catch {
      // ignore
    }
  },

  bindSocket: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    getSocket().on("bus:message", (msg: AgentMessage) => {
      set((s) => {
        if (s.messages.some((m) => m.seq === msg.seq)) return s;
        return { messages: [...s.messages, msg].slice(-500) };
      });
      // Spawn/report messages mean the task tree changed.
      if (msg.kind === "spawn" || msg.kind === "report") void get().loadTasks();
    });
  },
}));
