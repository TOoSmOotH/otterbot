import { create } from "zustand";
import type { AppManifest, AppTemplate } from "@otterbot/shared";

interface AppState {
  apps: AppManifest[];
  templates: AppTemplate[];
  loading: boolean;
  error: string | null;
  selectedAppId: string | null;

  loadApps: (projectId?: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  deleteApp: (projectId: string, appId: string) => Promise<boolean>;

  // Socket-driven state updaters
  addApp: (app: AppManifest) => void;
  updateApp: (app: AppManifest) => void;
  removeApp: (appId: string) => void;

  setSelectedAppId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  apps: [],
  templates: [],
  loading: false,
  error: null,
  selectedAppId: null,

  loadApps: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const qs = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`/api/apps${qs}`);
      if (!res.ok) throw new Error("Failed to load apps");
      const data = await res.json();
      set({ apps: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  loadTemplates: async () => {
    try {
      const res = await fetch("/api/app-templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      set({ templates: data });
    } catch (err) {
      console.warn("Failed to load app templates:", err);
    }
  },

  deleteApp: async (projectId, appId) => {
    try {
      const res = await fetch(`/api/apps/${projectId}/${appId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete app");
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  addApp: (app) => {
    set((state) => {
      if (state.apps.some((a) => a.id === app.id)) return state;
      return { apps: [...state.apps, app] };
    });
  },

  updateApp: (app) => {
    set((state) => ({
      apps: state.apps.map((a) => (a.id === app.id ? app : a)),
    }));
  },

  removeApp: (appId) => {
    set((state) => ({
      apps: state.apps.filter((a) => a.id !== appId),
      selectedAppId:
        state.selectedAppId === appId ? null : state.selectedAppId,
    }));
  },

  setSelectedAppId: (id) => set({ selectedAppId: id }),
}));
