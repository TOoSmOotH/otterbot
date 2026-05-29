import { create } from "zustand";
import { apiFetch } from "../lib/api";
import { getSocket } from "../lib/socket";

export interface Project {
  id: string;
  name: string;
  repoPath: string;
  createdAt: string;
  members: Array<{ agentId: string; access: "read" | "write" }>;
  team: Array<{ role: string; agentId: string }>;
  mode: "local" | "existing" | "new";
  forgeAccountId: string | null;
  forgeRepo: string | null;
  baseBranch: string | null;
  monitorIssues: boolean;
  rules: string | null;
}

export interface ForgeAccount {
  id: string;
  provider: "github" | "gitea";
  label: string;
  baseUrl: string;
  username: string;
  hasToken: boolean;
  gitTransport: "https" | "ssh";
  committerName: string;
  committerEmail: string;
  signCommits: boolean;
  /** Managed SSH public key to add on the forge (ssh accounts only). */
  publicKey: string | null;
}

export interface PipelineStage {
  stage: string;
  agentId: string;
  status: "pass" | "fail" | "error";
  report: string;
  attempt: number;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  goal: string;
  status: "running" | "done" | "failed" | "cancelled";
  currentStage: string | null;
  attempt: number;
  issueNumber: number | null;
  prBranch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  stages: PipelineStage[];
}

interface ProjectsState {
  projects: Project[];
  forgeAccounts: ForgeAccount[];
  /** runs keyed by project id */
  runs: Record<string, PipelineRun[]>;
  error: string | null;
  socketBound: boolean;

  load: () => Promise<void>;
  loadForgeAccounts: () => Promise<void>;
  loadRuns: (projectId: string) => Promise<void>;
  bindSocket: () => void;

  create: (name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addMember: (projectId: string, agentId: string, access?: "read" | "write") => Promise<void>;
  setMemberAccess: (projectId: string, agentId: string, access: "read" | "write") => Promise<void>;
  removeMember: (projectId: string, agentId: string) => Promise<void>;

  addForgeAccount: (input: {
    provider: "github" | "gitea";
    label: string;
    baseUrl?: string;
    token: string;
    username?: string;
    gitTransport?: "https" | "ssh";
    committerName?: string;
    committerEmail?: string;
    signCommits?: boolean;
  }) => Promise<{ id: string; publicKey: string | null } | null>;
  deleteForgeAccount: (id: string) => Promise<void>;
  setForge: (
    projectId: string,
    input: {
      mode: "local" | "existing" | "new";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
    }
  ) => Promise<string | null>;
  setRules: (projectId: string, rules: string) => Promise<string | null>;

  startPipeline: (projectId: string, goal: string) => Promise<void>;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `request failed (${res.status})`;
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: [],
  forgeAccounts: [],
  runs: {},
  error: null,
  socketBound: false,

  load: async () => {
    const res = await apiFetch("/api/projects");
    if (res.ok) set({ projects: (await res.json()) as Project[], error: null });
  },

  loadForgeAccounts: async () => {
    const res = await apiFetch("/api/forge-accounts");
    if (res.ok) set({ forgeAccounts: (await res.json()) as ForgeAccount[] });
  },

  loadRuns: async (projectId) => {
    const res = await apiFetch(`/api/projects/${projectId}/pipeline-runs`);
    if (!res.ok) return;
    const runs = (await res.json()) as PipelineRun[];
    set((s) => ({ runs: { ...s.runs, [projectId]: runs } }));
  },

  bindSocket: () => {
    if (get().socketBound) return;
    set({ socketBound: true });
    getSocket().on("pipeline:update", (run: PipelineRun) => {
      set((s) => {
        const list = s.runs[run.projectId] ?? [];
        const next = list.some((r) => r.id === run.id)
          ? list.map((r) => (r.id === run.id ? run : r))
          : [run, ...list];
        return { runs: { ...s.runs, [run.projectId]: next } };
      });
    });
  },

  create: async (name) => {
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    set({ error: null });
    await get().load();
  },

  remove: async (id) => {
    const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    if (res.ok) await get().load();
  },

  addMember: async (projectId, agentId, access = "read") => {
    const res = await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, access }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    await get().load();
  },

  setMemberAccess: async (projectId, agentId, access) => {
    const res = await apiFetch(`/api/projects/${projectId}/members/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    await get().load();
  },

  removeMember: async (projectId, agentId) => {
    const res = await apiFetch(`/api/projects/${projectId}/members/${encodeURIComponent(agentId)}`, {
      method: "DELETE",
    });
    if (res.ok) await get().load();
  },

  addForgeAccount: async (input) => {
    const res = await apiFetch("/api/forge-accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      set({ error: await readError(res) });
      return null;
    }
    set({ error: null });
    const created = (await res.json().catch(() => null)) as { id: string; publicKey: string | null } | null;
    await get().loadForgeAccounts();
    return created;
  },

  deleteForgeAccount: async (id) => {
    const res = await apiFetch(`/api/forge-accounts/${id}`, { method: "DELETE" });
    if (res.ok) await get().loadForgeAccounts();
  },

  setForge: async (projectId, input) => {
    const res = await apiFetch(`/api/projects/${projectId}/forge`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = await readError(res);
      set({ error: err });
      return err;
    }
    set({ error: null });
    await get().load();
    return null;
  },

  setRules: async (projectId, rules) => {
    const res = await apiFetch(`/api/projects/${projectId}/rules`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    if (!res.ok) {
      const err = await readError(res);
      set({ error: err });
      return err;
    }
    set({ error: null });
    await get().load();
    return null;
  },

  startPipeline: async (projectId, goal) => {
    const res = await apiFetch(`/api/projects/${projectId}/pipeline`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    set({ error: null });
    await get().loadRuns(projectId);
  },
}));
