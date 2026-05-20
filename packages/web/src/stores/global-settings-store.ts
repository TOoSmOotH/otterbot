import { create } from "zustand";
import { apiFetch } from "../lib/api";
import type { GlobalSettings, ThemeId } from "@otterbot/shared";

export const THEMES: Record<ThemeId, { label: string; vars: Record<string, string> }> = {
  obsidian: {
    label: "Obsidian",
    vars: {
      "--bg": "20 20 24",
      "--surface": "26 26 31",
      "--surface-elevated": "32 32 38",
      "--surface-sunken": "15 15 18",
      "--fg": "235 235 240",
      "--muted": "150 150 160",
      "--subtle": "100 100 110",
      "--border": "55 55 65",
      "--border-strong": "80 80 92",
      "--ring": "99 140 255",
      "--accent": "99 140 255",
      "--accent-fg": "255 255 255",
      "--accent-hover": "120 158 255",
      "--success": "74 222 128",
      "--success-bg": "20 50 30",
      "--warning": "251 191 36",
      "--warning-bg": "60 45 15",
      "--info": "107 140 255",
      "--info-bg": "25 32 55",
      "--danger": "248 113 113",
      "--danger-bg": "55 25 28",
      "--neutral": "120 120 130",
      "--neutral-bg": "40 40 46",
      "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.4)",
      "--shadow-md": "0 4px 12px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.5)",
      "--shadow-lg": "0 16px 48px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)",
    },
  },
  light: {
    label: "Light",
    vars: {
      "--bg": "247 248 245",
      "--surface": "255 255 255",
      "--surface-elevated": "255 255 255",
      "--surface-sunken": "240 241 238",
      "--fg": "30 35 40",
      "--muted": "85 95 100",
      "--subtle": "140 148 152",
      "--border": "215 220 218",
      "--border-strong": "180 188 184",
      "--ring": "22 132 120",
      "--accent": "22 132 120",
      "--accent-fg": "255 255 255",
      "--accent-hover": "16 110 100",
      "--success": "22 132 90",
      "--success-bg": "224 244 232",
      "--warning": "184 134 11",
      "--warning-bg": "252 244 220",
      "--info": "30 100 200",
      "--info-bg": "224 234 248",
      "--danger": "200 50 60",
      "--danger-bg": "252 228 230",
      "--neutral": "150 158 162",
      "--neutral-bg": "232 236 234",
      "--shadow-sm": "0 1px 2px rgba(20, 30, 40, 0.06)",
      "--shadow-md": "0 6px 16px rgba(20, 30, 40, 0.08), 0 1px 2px rgba(20, 30, 40, 0.05)",
      "--shadow-lg": "0 20px 50px rgba(20, 30, 40, 0.14), 0 2px 6px rgba(20, 30, 40, 0.06)",
    },
  },
  forest: {
    label: "Forest",
    vars: {
      "--bg": "17 26 22",
      "--surface": "22 33 28",
      "--surface-elevated": "28 41 35",
      "--surface-sunken": "12 19 16",
      "--fg": "232 238 229",
      "--muted": "160 174 164",
      "--subtle": "115 130 122",
      "--border": "58 76 66",
      "--border-strong": "85 105 92",
      "--ring": "212 139 76",
      "--accent": "212 139 76",
      "--accent-fg": "20 28 24",
      "--accent-hover": "228 158 96",
      "--success": "126 192 110",
      "--success-bg": "26 48 32",
      "--warning": "228 178 84",
      "--warning-bg": "52 42 20",
      "--info": "138 174 200",
      "--info-bg": "24 38 48",
      "--danger": "224 110 110",
      "--danger-bg": "52 26 26",
      "--neutral": "118 134 124",
      "--neutral-bg": "32 44 38",
      "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.4)",
      "--shadow-md": "0 4px 12px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.5)",
      "--shadow-lg": "0 16px 48px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)",
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
