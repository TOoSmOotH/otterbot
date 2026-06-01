import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { Connection, Credential, SkillConfigSchema } from "@otterbot/shared";

/** Registry descriptor for a connection type (from `/api/connection-types`). */
export interface ConnectionTypeDef {
  type: string;
  label: string;
  isChat: boolean;
  credentialType: string | null;
  configSchema: SkillConfigSchema;
}

/** Registry descriptor for a credential type (from `/api/credential-types`). */
export interface CredentialTypeDef {
  type: string;
  label: string;
  fieldSchema: SkillConfigSchema;
}

interface ConnectionsState {
  connections: Connection[];
  credentials: Credential[];
  connectionTypes: ConnectionTypeDef[];
  credentialTypes: CredentialTypeDef[];
  loading: boolean;
  busy: boolean;
  error: string;
  load: () => Promise<void>;
  createCredential: (input: { type: string; label: string; secrets: Record<string, string> }) => Promise<Credential | null>;
  updateCredential: (id: string, patch: { label?: string; secrets?: Record<string, string> }) => Promise<boolean>;
  deleteCredential: (id: string, force?: boolean) => Promise<{ ok: boolean; error?: string }>;
  createConnection: (input: { type: string; label: string; config?: Record<string, unknown>; credentialId?: string | null }) => Promise<Connection | null>;
  updateConnection: (id: string, patch: { label?: string; config?: Record<string, unknown>; credentialId?: string | null }) => Promise<boolean>;
  deleteConnection: (id: string, force?: boolean) => Promise<{ ok: boolean; error?: string }>;
}

async function json<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  credentials: [],
  connectionTypes: [],
  credentialTypes: [],
  loading: false,
  busy: false,
  error: "",

  load: async () => {
    set({ loading: true });
    try {
      const [conns, creds, ctypes, credTypes] = await Promise.all([
        apiFetch("/api/connections").then((r) => json<Connection[]>(r)),
        apiFetch("/api/credentials").then((r) => json<Credential[]>(r)),
        apiFetch("/api/connection-types").then((r) => json<ConnectionTypeDef[]>(r)),
        apiFetch("/api/credential-types").then((r) => json<CredentialTypeDef[]>(r)),
      ]);
      set({
        connections: conns ?? [],
        credentials: creds ?? [],
        connectionTypes: ctypes ?? [],
        credentialTypes: credTypes ?? [],
      });
    } finally {
      set({ loading: false });
    }
  },

  createCredential: async (input) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const cred = await json<Credential>(res);
      if (!cred) set({ error: "Failed to create credential." });
      await get().load();
      return cred;
    } finally {
      set({ busy: false });
    }
  },

  updateCredential: async (id, patch) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch(`/api/credentials/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      await get().load();
      return res.ok;
    } finally {
      set({ busy: false });
    }
  },

  deleteCredential: async (id, force) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch(`/api/credentials/${encodeURIComponent(id)}${force ? "?force=true" : ""}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      await get().load();
      return { ok: res.ok, error: body.error };
    } finally {
      set({ busy: false });
    }
  },

  createConnection: async (input) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const conn = await json<Connection>(res);
      if (!conn) set({ error: "Failed to create connection." });
      await get().load();
      return conn;
    } finally {
      set({ busy: false });
    }
  },

  updateConnection: async (id, patch) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch(`/api/connections/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      await get().load();
      return res.ok;
    } finally {
      set({ busy: false });
    }
  },

  deleteConnection: async (id, force) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch(`/api/connections/${encodeURIComponent(id)}${force ? "?force=true" : ""}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      await get().load();
      return { ok: res.ok, error: body.error };
    } finally {
      set({ busy: false });
    }
  },
}));

/** Assign a connection to an agent. */
export async function assignConnection(agentId: string, connectionId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/connections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connectionId }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: body.error };
}

/** Unassign a connection from an agent. */
export async function unassignConnection(agentId: string, connectionId: string): Promise<void> {
  await apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" }
  );
}

/** Connections currently assigned to an agent. */
export async function fetchAgentConnections(agentId: string): Promise<Connection[]> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/connections`);
  return (await json<Connection[]>(res)) ?? [];
}
