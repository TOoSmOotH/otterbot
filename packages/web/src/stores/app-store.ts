import { create } from "zustand";
import type { AppManifest, AppTemplate } from "@otterbot/shared";
import {
  createLoadItems,
  createLoadTemplates,
  createDeleteItem,
  createAddItem,
  createUpdateItem,
  createRemoveItem,
} from "./create-studio-store";

const config = { apiPath: "/api/apps", templatePath: "/api/app-templates" };

interface AppState {
  apps: AppManifest[];
  templates: AppTemplate[];
  loading: boolean;
  error: string | null;
  selectedAppId: string | null;

  loadApps: (projectId?: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  deleteApp: (projectId: string, appId: string) => Promise<boolean>;

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

  loadApps: createLoadItems<AppManifest>(config, set as any, "apps"),
  loadTemplates: createLoadTemplates(config, set as any),
  deleteApp: createDeleteItem(config, set as any),

  addApp: (app) => set((state) => createAddItem<AppManifest>("apps")(app, state as any) as any),
  updateApp: (app) => set((state) => createUpdateItem<AppManifest>("apps")(app, state as any) as any),
  removeApp: (appId) => set((state) => createRemoveItem<AppManifest>("apps", "selectedAppId")(appId, state as any) as any),

  setSelectedAppId: (id) => set({ selectedAppId: id }),
}));
