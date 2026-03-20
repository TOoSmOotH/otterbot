import type { GameManifest } from "@otterbot/shared";
import { useGameStore } from "../../stores/game-store";
import type { StudioGalleryConfig } from "./StudioGallery";

const ENGINE_LABELS: Record<string, string> = {
  threejs: "Three.js",
  babylonjs: "Babylon.js",
  phaser: "Phaser",
  playcanvas: "PlayCanvas",
  canvas: "Canvas 2D",
  custom: "Custom",
};

const ENGINE_COLORS: Record<string, string> = {
  threejs: "bg-emerald-500/20 text-emerald-400",
  babylonjs: "bg-orange-500/20 text-orange-400",
  phaser: "bg-purple-500/20 text-purple-400",
  playcanvas: "bg-sky-500/20 text-sky-400",
  canvas: "bg-yellow-500/20 text-yellow-400",
  custom: "bg-zinc-500/20 text-zinc-400",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-400",
  building: "bg-yellow-500/20 text-yellow-400",
  playable: "bg-emerald-500/20 text-emerald-400",
  testing: "bg-blue-500/20 text-blue-400",
  published: "bg-violet-500/20 text-violet-400",
};

export const gameConfig: StudioGalleryConfig<GameManifest> = {
  studioLabel: "Game Studio",
  entityName: "game",
  entityNamePlural: "games",

  useItems: () => useGameStore((s) => s.games),
  useLoading: () => useGameStore((s) => s.loading),
  loadItems: (projectId) => useGameStore.getState().loadGames(projectId),
  loadTemplates: () => useGameStore.getState().loadTemplates(),
  deleteItem: (projectId, id) => useGameStore.getState().deleteGame(projectId, id),

  getId: (g) => g.id,
  getProjectId: (g) => g.projectId,
  getName: (g) => g.name,
  getDescription: (g) => g.description || undefined,
  getTags: (g) => g.tags,
  getUpdatedAt: (g) => g.updatedAt,

  getCategoryBadge: (g) => ({
    label: ENGINE_LABELS[g.engine] ?? g.engine,
    className: ENGINE_COLORS[g.engine] ?? ENGINE_COLORS.custom,
  }),
  getStatusBadge: (g) => ({
    label: g.status,
    className: STATUS_COLORS[g.status] ?? STATUS_COLORS.draft,
  }),

  renderThumbnail: (g) => {
    const is2D = g.engine === "phaser" || g.engine === "canvas";
    return <div className="text-4xl opacity-30">{is2D ? "2D" : "3D"}</div>;
  },

  filterOptions: Object.entries(ENGINE_LABELS).map(([key, label]) => ({ key, label })),
  getFilterValue: (g) => g.engine,

  actionableStatuses: ["playable", "published"],
  actionLabel: "Play",
  getIframeSrc: (g) => `/api/games/${g.projectId}/${g.id}/play/index.html`,
  getNewTabUrl: (g) => `/api/games/${g.projectId}/${g.id}/play/index.html`,

  emptyHint: "No games yet. Ask your agents to create one!",
  emptyExamples:
    'Try: "Create a 3D game where you dodge falling cubes using Three.js" or "Make a 2D platformer with Phaser"',

  showSidecarStatus: true,
};
