import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { CodeReferenceStatus } from "@otterbot/shared";

interface CodeReferenceState {
  status: CodeReferenceStatus | null;
  loading: boolean;
  busy: boolean;
  error: string;
  polling: number | null;
  load: () => Promise<void>;
  addRepo: (url: string, ref?: string) => Promise<boolean>;
  removeRepo: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  setPullCron: (cron: string) => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useCodeReferenceStore = create<CodeReferenceState>((set, get) => ({
  status: null,
  loading: false,
  busy: false,
  error: "",
  polling: null,

  load: async () => {
    set({ loading: true });
    try {
      const res = await apiFetch("/api/code-reference/status");
      if (!res.ok) return;
      const status = (await res.json()) as CodeReferenceStatus;
      set({ status });
      // Auto-manage polling based on whether anything is in flight.
      const inFlight =
        status.indexing || status.repos.some((r) => r.state === "cloning" || r.state === "indexing");
      if (inFlight) get().startPolling();
      else get().stopPolling();
    } finally {
      set({ loading: false });
    }
  },

  addRepo: async (url, ref) => {
    set({ busy: true, error: "" });
    try {
      const res = await apiFetch("/api/code-reference/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, ref: ref || undefined }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        set({ error: body.error ?? "Failed to add repository." });
        return false;
      }
      await get().load();
      get().startPolling();
      return true;
    } finally {
      set({ busy: false });
    }
  },

  removeRepo: async (id) => {
    set({ busy: true });
    try {
      await apiFetch(`/api/code-reference/repos/${id}`, { method: "DELETE" });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  refresh: async (id) => {
    await apiFetch(`/api/code-reference/repos/${id}/refresh`, { method: "POST" });
    await get().load();
    get().startPolling();
  },

  setPullCron: async (cron) => {
    set({ busy: true });
    try {
      await apiFetch("/api/code-reference/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pullCron: cron }),
      });
      await get().load();
    } finally {
      set({ busy: false });
    }
  },

  startPolling: () => {
    if (get().polling !== null) return;
    const timer = window.setInterval(() => void get().load(), 2500);
    set({ polling: timer });
  },

  stopPolling: () => {
    const timer = get().polling;
    if (timer !== null) {
      clearInterval(timer);
      set({ polling: null });
    }
  },
}));
