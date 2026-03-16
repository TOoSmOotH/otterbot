import { create } from "zustand";
import type { GameManifest, GameTemplate } from "@otterbot/shared";

interface GameState {
  games: GameManifest[];
  templates: GameTemplate[];
  loading: boolean;
  error: string | null;
  selectedGameId: string | null;

  loadGames: (projectId?: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  deleteGame: (projectId: string, gameId: string) => Promise<boolean>;

  // Socket-driven state updaters
  addGame: (game: GameManifest) => void;
  updateGame: (game: GameManifest) => void;
  removeGame: (gameId: string) => void;

  setSelectedGameId: (id: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  games: [],
  templates: [],
  loading: false,
  error: null,
  selectedGameId: null,

  loadGames: async (projectId) => {
    set({ loading: true, error: null });
    try {
      const qs = projectId ? `?projectId=${projectId}` : "";
      const res = await fetch(`/api/games${qs}`);
      if (!res.ok) throw new Error("Failed to load games");
      const data = await res.json();
      set({ games: data, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  },

  loadTemplates: async () => {
    try {
      const res = await fetch("/api/game-templates");
      if (!res.ok) throw new Error("Failed to load templates");
      const data = await res.json();
      set({ templates: data });
    } catch (err) {
      console.warn("Failed to load game templates:", err);
    }
  },

  deleteGame: async (projectId, gameId) => {
    try {
      const res = await fetch(`/api/games/${projectId}/${gameId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete game");
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Unknown error" });
      return false;
    }
  },

  addGame: (game) => {
    set((state) => {
      if (state.games.some((g) => g.id === game.id)) return state;
      return { games: [...state.games, game] };
    });
  },

  updateGame: (game) => {
    set((state) => ({
      games: state.games.map((g) => (g.id === game.id ? game : g)),
    }));
  },

  removeGame: (gameId) => {
    set((state) => ({
      games: state.games.filter((g) => g.id !== gameId),
      selectedGameId:
        state.selectedGameId === gameId ? null : state.selectedGameId,
    }));
  },

  setSelectedGameId: (id) => set({ selectedGameId: id }),
}));
