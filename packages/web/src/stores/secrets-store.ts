import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { AgentCredentialEntry, CredentialScope } from "@otterbot/shared";

/**
 * Instance-wide (global) secrets shared by every agent — the Settings → Secrets
 * tab. Values are write-only: the server returns only keys + scopes, never the
 * stored value. Every mutation restarts all agents server-side.
 */
interface SecretsState {
  keys: AgentCredentialEntry[];
  loading: boolean;
  busy: boolean;
  error: string;
  load: () => Promise<void>;
  /** Add or update a single secret. */
  upsert: (key: string, value: string, scope: CredentialScope) => Promise<boolean>;
  setScope: (key: string, scope: CredentialScope) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsState>((set, get) => ({
  keys: [],
  loading: false,
  busy: false,
  error: "",

  load: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch("/api/secrets");
      if (!res.ok) return;
      const body = (await res.json()) as { keys: AgentCredentialEntry[] };
      set({ keys: body.keys ?? [] });
    } finally {
      set({ loading: false });
    }
  },

  upsert: async (key, value, scope) => {
    const k = key.trim();
    if (!k) {
      set({ error: "Key is required." });
      return false;
    }
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/secrets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [k]: { value, scope } }),
      });
      if (!res.ok) {
        set({ error: "Failed to save secret." });
        return false;
      }
      await get().load();
      return true;
    } finally {
      set({ busy: false });
    }
  },

  setScope: async (key, scope) => {
    set({ busy: true });
    try {
      await apiFetch(`/api/secrets/${encodeURIComponent(key)}/scope`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  remove: async (key) => {
    set({ busy: true });
    try {
      await apiFetch(`/api/secrets/${encodeURIComponent(key)}`, { method: "DELETE" });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },
}));
