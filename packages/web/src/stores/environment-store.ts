import { create } from "zustand";
import type { EnvironmentPack, SceneConfig } from "@otterbot/shared";

interface EnvironmentState {
  packs: EnvironmentPack[];
  scenes: SceneConfig[];
  activeSceneId: string;
  loading: boolean;
  loaded: boolean;
  loadEnvironment: () => Promise<void>;
  reloadEnvironment: () => Promise<void>;
  setActiveSceneId: (id: string) => void;
  getActiveScene: () => SceneConfig | undefined;
  resolveAssetUrl: (assetRef: string) => string | undefined;
}

export const useEnvironmentStore = create<EnvironmentState>((set, get) => ({
  packs: [],
  scenes: [],
  activeSceneId: "default-office",
  loading: false,
  loaded: false,

  loadEnvironment: async () => {
    if (get().loading) return;
    if (get().loaded) return;
    set({ loading: true });
    try {
      const [packsRes, scenesRes] = await Promise.all([
        fetch("/api/environment-packs"),
        fetch("/api/scenes"),
      ]);
      const packs = packsRes.ok ? await packsRes.json() : [];
      const scenes = scenesRes.ok ? await scenesRes.json() : [];
      console.log(
        "[environment-store] loaded",
        packs.length,
        "packs,",
        scenes.length,
        "scenes",
      );
      set({ packs, scenes, loaded: true });
    } catch (err) {
      console.error("[environment-store] error:", err);
    } finally {
      set({ loading: false });
    }
  },

  reloadEnvironment: async () => {
    set({ loading: true });
    try {
      const [packsRes, scenesRes] = await Promise.all([
        fetch("/api/environment-packs"),
        fetch("/api/scenes"),
      ]);
      const packs = packsRes.ok ? await packsRes.json() : [];
      const scenes = scenesRes.ok ? await scenesRes.json() : [];
      console.log(
        "[environment-store] reloaded",
        packs.length,
        "packs,",
        scenes.length,
        "scenes",
      );
      set({ packs, scenes, loaded: true });
    } catch (err) {
      console.error("[environment-store] reload error:", err);
    } finally {
      set({ loading: false });
    }
  },

  setActiveSceneId: (id) => {
    set({ activeSceneId: id });
  },

  getActiveScene: () => {
    const { scenes, activeSceneId } = get();
    return scenes.find((s) => s.id === activeSceneId);
  },

  resolveAssetUrl: (assetRef: string) => {
    const [packId, assetId] = assetRef.split("/");
    const pack = get().packs.find((p) => p.id === packId);
    if (!pack) return undefined;
    const asset = pack.assets.find((a) => a.id === assetId);
    return asset?.modelUrl;
  },
}));
