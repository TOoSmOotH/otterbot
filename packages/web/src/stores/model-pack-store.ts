import { create } from "zustand";
import type { ModelPack } from "@smoothbot/shared";

interface ModelPackState {
  packs: ModelPack[];
  loading: boolean;
  loaded: boolean;
  loadPacks: () => Promise<void>;
  getPackById: (id: string) => ModelPack | undefined;
}

export const useModelPackStore = create<ModelPackState>((set, get) => ({
  packs: [],
  loading: false,
  loaded: false,

  loadPacks: async () => {
    if (get().loading) return;
    if (get().loaded && get().packs.length > 0) return;
    set({ loading: true });
    try {
      const res = await fetch("/api/model-packs");
      if (!res.ok) {
        console.error("[model-pack-store] fetch failed:", res.status, res.statusText);
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) {
        console.error("[model-pack-store] unexpected response:", data);
        return;
      }
      console.log("[model-pack-store] loaded", data.length, "packs");
      set({ packs: data, loaded: true });
    } catch (err) {
      console.error("[model-pack-store] error:", err);
    } finally {
      set({ loading: false });
    }
  },

  getPackById: (id: string) => {
    return get().packs.find((p) => p.id === id);
  },
}));
