import { create } from "zustand";
import { apiFetch } from "../lib/api";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  members: string[];
}

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addMember: (projectId: string, agentId: string) => Promise<void>;
  removeMember: (projectId: string, agentId: string) => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `request failed (${res.status})`;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch("/api/projects");
      if (!res.ok) return;
      set({ projects: (await res.json()) as Project[], error: null });
    } finally {
      set({ loading: false });
    }
  },

  create: async (name) => {
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      set({ error: await readError(res) });
      return;
    }
    set({ error: null });
    await get().load();
  },

  remove: async (id) => {
    const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) await get().load();
  },

  addMember: async (projectId, agentId) => {
    const res = await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    if (!res.ok) {
      set({ error: await readError(res) });
      return;
    }
    set({ error: null });
    await get().load();
  },

  removeMember: async (projectId, agentId) => {
    const res = await apiFetch(
      `/api/projects/${projectId}/members/${encodeURIComponent(agentId)}`,
      { method: "DELETE" }
    );
    if (res.ok) await get().load();
  },
}));
