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
      const data = await res.json();
      set({ packs: data, loaded: true });
    } catch {
      // silently fail
    } finally {
      set({ loading: false });
    }
  },

  getPackById: (id: string) => {
    return get().packs.find((p) => p.id === id);
  },
}));
