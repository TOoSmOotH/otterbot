import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string; // masked: "...XXXX"
  apiKeySet: boolean;
  baseUrl?: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
}

export interface TierDefaults {
  coo: { provider: string; model: string };
  teamLead: { provider: string; model: string };
  worker: { provider: string; model: string };
}

export interface TestResult {
  ok: boolean;
  error?: string;
  testing: boolean;
}

interface SettingsState {
  providers: ProviderConfig[];
  defaults: TierDefaults;
  models: Record<string, string[]>; // providerId → model list
  loading: boolean;
  error: string | null;
  testResults: Record<string, TestResult>;

  loadSettings: () => Promise<void>;
  updateProvider: (
    id: string,
    data: { apiKey?: string; baseUrl?: string },
  ) => Promise<void>;
  updateDefaults: (data: Partial<TierDefaults>) => Promise<void>;
  testProvider: (id: string, model?: string) => Promise<void>;
  fetchModels: (providerId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>((set, get) => ({
  providers: [],
  defaults: {
    coo: { provider: "anthropic", model: "" },
    teamLead: { provider: "anthropic", model: "" },
    worker: { provider: "anthropic", model: "" },
  },
  models: {},
  loading: false,
  error: null,
  testResults: {},

  loadSettings: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      set({
        providers: data.providers,
        defaults: data.defaults,
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  updateProvider: async (id, data) => {
    set({ error: null });
    try {
      const res = await fetch(`/api/settings/provider/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update provider");
      // Reload settings to get fresh masked keys
      await get().loadSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  updateDefaults: async (data) => {
    set({ error: null });
    try {
      const res = await fetch("/api/settings/defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update defaults");
      await get().loadSettings();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  testProvider: async (id, model) => {
    set((s) => ({
      testResults: {
        ...s.testResults,
        [id]: { ok: false, testing: true },
      },
    }));
    try {
      const res = await fetch(`/api/settings/provider/${id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await res.json();
      set((s) => ({
        testResults: {
          ...s.testResults,
          [id]: { ok: data.ok, error: data.error, testing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        testResults: {
          ...s.testResults,
          [id]: {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
            testing: false,
          },
        },
      }));
    }
  },

  fetchModels: async (providerId) => {
    try {
      const res = await fetch(`/api/settings/models/${providerId}`);
      if (!res.ok) return;
      const data = await res.json();
      set((s) => ({
        models: { ...s.models, [providerId]: data.models },
      }));
    } catch {
      // Silently fail — user can still type model names manually
    }
  },
}));
