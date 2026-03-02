import { create } from "zustand";

export interface Explosion {
  id: string;
  position: [number, number, number];
  color: string;
  startTime: number;
}

interface ExplosionState {
  explosions: Map<string, Explosion>;
  addExplosion: (id: string, position: [number, number, number], color: string) => void;
  removeExplosion: (id: string) => void;
}

export const useExplosionStore = create<ExplosionState>((set) => ({
  explosions: new Map(),

  addExplosion: (id, position, color) =>
    set((state) => {
      const next = new Map(state.explosions);
      next.set(id, { id, position, color, startTime: Date.now() });
      return { explosions: next };
    }),

  removeExplosion: (id) =>
    set((state) => {
      const next = new Map(state.explosions);
      next.delete(id);
      return { explosions: next };
    }),
}));
