import { useEffect, useState } from "react";
import { useGameStore } from "../../stores/game-store";
import type { GameManifest } from "@otterbot/shared";

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

function GameCard({ game, onPlay, onDelete }: {
  game: GameManifest;
  onPlay: (game: GameManifest) => void;
  onDelete: (game: GameManifest) => void;
}) {
  return (
    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg overflow-hidden hover:border-zinc-600/50 transition-colors group">
      {/* Thumbnail area */}
      <div className="h-36 bg-zinc-900 flex items-center justify-center relative">
        <div className="text-4xl opacity-30">
          {game.engine === "phaser" || game.engine === "canvas" ? "2D" : "3D"}
        </div>
        {game.status === "playable" || game.status === "published" ? (
          <button
            onClick={() => onPlay(game)}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <span className="text-white text-lg font-medium">Play</span>
          </button>
        ) : null}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-200 truncate">{game.name}</h3>
          <button
            onClick={() => onDelete(game)}
            className="text-zinc-500 hover:text-red-400 shrink-0 text-xs"
            title="Delete game"
          >
            &times;
          </button>
        </div>

        {game.description && (
          <p className="text-xs text-zinc-400 line-clamp-2">{game.description}</p>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ENGINE_COLORS[game.engine] ?? ENGINE_COLORS.custom}`}>
            {ENGINE_LABELS[game.engine] ?? game.engine}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[game.status] ?? STATUS_COLORS.draft}`}>
            {game.status}
          </span>
        </div>

        {game.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {game.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="text-[10px] text-zinc-500">
          {new Date(game.updatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

export function GameStudio() {
  const games = useGameStore((s) => s.games);
  const loading = useGameStore((s) => s.loading);
  const loadGames = useGameStore((s) => s.loadGames);
  const loadTemplates = useGameStore((s) => s.loadTemplates);
  const deleteGame = useGameStore((s) => s.deleteGame);
  const [filterEngine, setFilterEngine] = useState<string>("");
  const [playingGame, setPlayingGame] = useState<GameManifest | null>(null);

  useEffect(() => {
    loadGames();
    loadTemplates();
  }, [loadGames, loadTemplates]);

  const filteredGames = filterEngine
    ? games.filter((g) => g.engine === filterEngine)
    : games;

  const handlePlay = (game: GameManifest) => {
    setPlayingGame(game);
  };

  const handleDelete = async (game: GameManifest) => {
    if (!confirm(`Delete "${game.name}"? This cannot be undone.`)) return;
    await deleteGame(game.projectId, game.id);
    loadGames();
  };

  const handleClosePlayer = () => {
    setPlayingGame(null);
  };

  // Full-screen game player
  if (playingGame) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/50">
          <div className="flex items-center gap-3">
            <button
              onClick={handleClosePlayer}
              className="text-zinc-400 hover:text-zinc-200 text-sm"
            >
              &larr; Back
            </button>
            <span className="text-sm text-zinc-200 font-medium">{playingGame.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${ENGINE_COLORS[playingGame.engine] ?? ENGINE_COLORS.custom}`}>
              {ENGINE_LABELS[playingGame.engine] ?? playingGame.engine}
            </span>
          </div>
          <button
            onClick={() => {
              const url = `/api/games/${playingGame.projectId}/${playingGame.id}/play/index.html`;
              window.open(url, "_blank");
            }}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            Open in new tab
          </button>
        </div>
        <div className="flex-1">
          <iframe
            src={`/api/games/${playingGame.projectId}/${playingGame.id}/play/index.html`}
            className="w-full h-full border-0"
            title={playingGame.name}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Game Studio</h2>
          <span className="text-xs text-zinc-500">{games.length} game{games.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Engine filter */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterEngine("")}
            className={`text-xs px-2 py-1 rounded ${!filterEngine ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            All
          </button>
          {Object.entries(ENGINE_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilterEngine(key === filterEngine ? "" : key)}
              className={`text-xs px-2 py-1 rounded ${filterEngine === key ? "bg-zinc-700 text-zinc-200" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Loading games...
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-zinc-500 space-y-3">
            <div className="text-4xl opacity-30">
              {filterEngine ? (
                ENGINE_LABELS[filterEngine] ?? filterEngine
              ) : (
                "Game Studio"
              )}
            </div>
            <p className="text-sm">
              {filterEngine
                ? `No ${ENGINE_LABELS[filterEngine]} games yet.`
                : "No games yet. Ask your agents to create one!"}
            </p>
            <p className="text-xs text-zinc-600 max-w-md text-center">
              Try: &quot;Create a 3D game where you dodge falling cubes using Three.js&quot; or
              &quot;Make a 2D platformer with Phaser&quot;
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filteredGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onPlay={handlePlay}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
