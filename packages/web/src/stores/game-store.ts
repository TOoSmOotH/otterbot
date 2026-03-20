import { create } from "zustand";
import type { GameManifest, GameTemplate } from "@otterbot/shared";
import {
  createLoadItems,
  createLoadTemplates,
  createDeleteItem,
  createAddItem,
  createUpdateItem,
  createRemoveItem,
} from "./create-studio-store";

const config = { apiPath: "/api/games", templatePath: "/api/game-templates" };

interface GameState {
  games: GameManifest[];
  templates: GameTemplate[];
  loading: boolean;
  error: string | null;
  selectedGameId: string | null;

  loadGames: (projectId?: string) => Promise<void>;
  loadTemplates: () => Promise<void>;
  deleteGame: (projectId: string, gameId: string) => Promise<boolean>;

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

  loadGames: createLoadItems<GameManifest>(config, set as any, "games"),
  loadTemplates: createLoadTemplates(config, set as any),
  deleteGame: createDeleteItem(config, set as any),

  addGame: (game) => set((state) => createAddItem<GameManifest>("games")(game, state as any) as any),
  updateGame: (game) => set((state) => createUpdateItem<GameManifest>("games")(game, state as any) as any),
  removeGame: (gameId) => set((state) => createRemoveItem<GameManifest>("games", "selectedGameId")(gameId, state as any) as any),

  setSelectedGameId: (id) => set({ selectedGameId: id }),
}));
