import { create } from "zustand";
import type { ModelPack, SceneConfig } from "@otterbot/shared";

interface SceneState {
  scenes: SceneConfig[];
  activeSceneId: string | null;
  modelPacks: ModelPack[];
  loaded: boolean;
  load: () => Promise<void>;
  setActiveSceneId: (id: string) => void;
  activeScene: () => SceneConfig | null;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  scenes: [],
  activeSceneId: null,
  modelPacks: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const [scenesRes, packsRes] = await Promise.all([
        fetch("/api/scenes"),
        fetch("/api/model-packs"),
      ]);
      const scenes = scenesRes.ok ? ((await scenesRes.json()) as SceneConfig[]) : [];
      const modelPacks = packsRes.ok ? ((await packsRes.json()) as ModelPack[]) : [];
      set({
        scenes,
        modelPacks,
        activeSceneId: scenes[0]?.id ?? null,
        loaded: true,
      });
    } catch (err) {
      console.error("[scene-store] load failed:", err);
      set({ loaded: true });
    }
  },
  setActiveSceneId: (id) => set({ activeSceneId: id }),
  activeScene: () => {
    const { scenes, activeSceneId } = get();
    return scenes.find((s) => s.id === activeSceneId) ?? scenes[0] ?? null;
  },
}));
