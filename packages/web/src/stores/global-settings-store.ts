import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { GlobalSettings, ThemeId } from "@otterbot/shared";

export const THEMES: Record<ThemeId, { label: string; vars: Record<string, string> }> = {
  obsidian: {
    label: "Obsidian",
    vars: {
      "--bg": "20 20 24",
      "--fg": "235 235 240",
      "--muted": "90 90 100",
      "--border": "55 55 65",
      "--accent": "99 140 255",
    },
  },
  light: {
    label: "Light",
    vars: {
      "--bg": "247 248 245",
      "--fg": "30 35 40",
      "--muted": "100 110 112",
      "--border": "205 211 209",
      "--accent": "22 132 120",
    },
  },
  forest: {
    label: "Forest",
    vars: {
      "--bg": "17 26 22",
      "--fg": "232 238 229",
      "--muted": "118 134 124",
      "--border": "58 76 66",
      "--accent": "212 139 76",
    },
  },
};

/**
 * Pre-load placeholder. The real settings — including the full provider list,
 * derived from the server's provider catalog — arrive via `load()`.
 */
const DEFAULT_SETTINGS: GlobalSettings = {
  theme: "obsidian",
  defaultChatModel: { provider: "lmstudio", account: "default", modelId: "local-model" },
  defaultEmbeddingModel: { provider: "lmstudio", account: "default", modelId: "local-model" },
  modelContextWindows: [],
  providers: {},
};

export function applyTheme(theme: ThemeId): void {
  const def = THEMES[theme] ?? THEMES.obsidian;
  for (const [key, value] of Object.entries(def.vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}

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
