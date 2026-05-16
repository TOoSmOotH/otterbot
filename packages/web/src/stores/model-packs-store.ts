import { create } from "zustand";
import type { ModelPack } from "@otterbot/shared";

interface ModelPacksState {
  packs: ModelPack[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useModelPacksStore = create<ModelPacksState>((set, get) => ({
  packs: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch("/api/model-packs");
      if (!res.ok) return;
      set({ packs: (await res.json()) as ModelPack[], loaded: true });
    } catch {
      // ignore — avatars degrade to initials
    }
  },
}));

/** Resolve a model pack's artwork thumbnail URL, or null if unknown. */
export function packThumbnail(packs: ModelPack[], packId: string): string | null {
  return packs.find((p) => p.id === packId)?.thumbnailUrl ?? null;
}
