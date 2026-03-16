import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import type { GameManifest, GameTemplate, GameEngine, GameStatus } from "@otterbot/shared";

const TEMPLATES_DIR = path.resolve(process.cwd(), "assets/game-templates");

/**
 * Discover available game templates from the assets/game-templates directory.
 */
export function listTemplates(): GameTemplate[] {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];

  const entries = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
  const templates: GameTemplate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templateJsonPath = path.join(TEMPLATES_DIR, entry.name, "template.json");
    if (!fs.existsSync(templateJsonPath)) continue;

    try {
      const raw = fs.readFileSync(templateJsonPath, "utf-8");
      const tmpl = JSON.parse(raw) as GameTemplate;
      templates.push(tmpl);
    } catch {
      console.warn(`[game-service] Failed to parse template: ${templateJsonPath}`);
    }
  }

  return templates;
}

/**
 * Get the games directory for a given workspace.
 */
function gamesDir(workspacePath: string): string {
  return path.join(workspacePath, "games");
}

/**
 * Get the directory for a specific game.
 */
function gameDir(workspacePath: string, gameId: string): string {
  return path.join(gamesDir(workspacePath), gameId);
}

/**
 * Create a new game from a template.
 */
export function createGame(
  workspacePath: string,
  opts: {
    name: string;
    description?: string;
    engine: GameEngine;
    templateId?: string;
    projectId: string;
    tags?: string[];
  },
): GameManifest {
  const gameId = nanoid(12);
  const dir = gameDir(workspacePath, gameId);

  // Create directory structure
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "textures"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "models"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "sounds"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets", "sprites"), { recursive: true });
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });

  // Copy template files if a template is specified
  const templateId = opts.templateId ?? `${opts.engine}-basic`;
  const templateDir = path.join(TEMPLATES_DIR, templateId);

  if (fs.existsSync(templateDir)) {
    copyDirRecursive(templateDir, dir, opts.name);
  }

  // Create manifest
  const now = new Date().toISOString();
  const manifest: GameManifest = {
    id: gameId,
    name: opts.name,
    description: opts.description ?? "",
    version: "0.1.0",
    engine: opts.engine,
    entryPoint: "index.html",
    tags: opts.tags ?? [],
    status: "draft" as GameStatus,
    projectId: opts.projectId,
    createdAt: now,
    updatedAt: now,
  };

  // Write manifest
  fs.writeFileSync(path.join(dir, "game.json"), JSON.stringify(manifest, null, 2));

  return manifest;
}

/**
 * List all games in a workspace.
 */
export function listGames(workspacePath: string): GameManifest[] {
  const dir = gamesDir(workspacePath);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const games: GameManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "game.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      games.push(JSON.parse(raw) as GameManifest);
    } catch {
      console.warn(`[game-service] Failed to parse game manifest: ${manifestPath}`);
    }
  }

  return games;
}

/**
 * Get a single game manifest.
 */
export function getGame(workspacePath: string, gameId: string): GameManifest | null {
  const manifestPath = path.join(gameDir(workspacePath, gameId), "game.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    return JSON.parse(raw) as GameManifest;
  } catch {
    return null;
  }
}

/**
 * Update a game manifest.
 */
export function updateGame(
  workspacePath: string,
  gameId: string,
  updates: Partial<Pick<GameManifest, "name" | "description" | "version" | "status" | "tags" | "thumbnail">>,
): GameManifest | null {
  const manifest = getGame(workspacePath, gameId);
  if (!manifest) return null;

  const updated: GameManifest = {
    ...manifest,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(gameDir(workspacePath, gameId), "game.json");
  fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Delete a game and its files.
 */
export function deleteGame(workspacePath: string, gameId: string): boolean {
  const dir = gameDir(workspacePath, gameId);
  if (!fs.existsSync(dir)) return false;

  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Build a game by copying source files to dist/.
 * For the MVP, this is a simple file copy. Future versions could bundle/minify.
 */
export function buildGame(workspacePath: string, gameId: string): { ok: boolean; error?: string } {
  const dir = gameDir(workspacePath, gameId);
  const manifestPath = path.join(dir, "game.json");

  if (!fs.existsSync(manifestPath)) {
    return { ok: false, error: "Game not found" };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as GameManifest;
  const distDir = path.join(dir, "dist");

  // Clean dist
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // Copy all game files to dist (excluding dist itself and game.json)
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "game.json" || entry.name === "template.json") continue;
    const src = path.join(dir, entry.name);
    const dest = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // Update manifest status
  manifest.status = "playable" as GameStatus;
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return { ok: true };
}

/**
 * Get the absolute path to a game's dist directory for static file serving.
 */
export function getGameDistPath(workspacePath: string, gameId: string): string | null {
  const dist = path.join(gameDir(workspacePath, gameId), "dist");
  return fs.existsSync(dist) ? dist : null;
}

/**
 * Get the absolute path to a game's source directory.
 */
export function getGameSourcePath(workspacePath: string, gameId: string): string | null {
  const dir = gameDir(workspacePath, gameId);
  return fs.existsSync(dir) ? dir : null;
}

// --- Helpers ---

function copyDirRecursive(src: string, dest: string, gameName?: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.name === "template.json") continue;

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, gameName);
    } else {
      let content = fs.readFileSync(srcPath, "utf-8");
      // Replace template placeholders
      if (gameName) {
        content = content.replace(/\{\{GAME_NAME\}\}/g, gameName);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}
