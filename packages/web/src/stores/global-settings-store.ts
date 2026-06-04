import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { GlobalSettings } from "@otterbot/shared";
import { applyTheme } from "../lib/themes";

export { THEMES, applyTheme } from "../lib/themes";

/**
 * Pre-load placeholder. The real settings — including the full provider list,
 * derived from the server's provider catalog — arrive via `load()`.
 */
const DEFAULT_SETTINGS: GlobalSettings = {
  theme: "playful",
  models: [],
  defaultChatModelId: "",
  defaultEmbeddingModelId: "",
  providers: {},
  codingModelPresets: [],
};

interface GlobalSettingsState {
  settings: GlobalSettings;
  loading: boolean;
  loaded: boolean;
  saving: boolean;
  load: () => Promise<void>;
  save: (settings: GlobalSettings) => Promise<GlobalSettings | null>;
}

export const useGlobalSettingsStore = create<GlobalSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,
  loaded: false,
  saving: false,

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await apiFetch("/api/settings/global");
      if (!res.ok) return;
      const settings = (await res.json()) as GlobalSettings;
      applyTheme(settings.theme);
      set({ settings, loaded: true });
    } finally {
      set({ loading: false });
    }
  },

  save: async (settings) => {
    set({ saving: true });
    try {
      const res = await apiFetch("/api/settings/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) return null;
      const saved = (await res.json()) as GlobalSettings;
      applyTheme(saved.theme);
      set({ settings: saved, loaded: true });
      return saved;
    } finally {
      set({ saving: false });
    }
  },
}));
