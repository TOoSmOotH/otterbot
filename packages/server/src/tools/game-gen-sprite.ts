import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getImageProvider } from "../games/asset-providers/asset-adapter.js";
import { getGame } from "../games/game-service.js";
import type { GameAsset } from "@otterbot/shared";

export function createGameGenSpriteTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a 2D sprite or sprite sheet for a game. Optimized for game sprites: " +
      "characters, items, UI elements, tilesets. Saves to assets/sprites/.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to add the sprite to"),
      prompt: z.string().describe("Description of the sprite (e.g. 'pixel art knight character', 'treasure chest item')"),
      filename: z.string().optional().describe("Output filename (without extension)"),
      width: z.number().optional().describe("Width in pixels (default: 64 for sprites)"),
      height: z.number().optional().describe("Height in pixels (default: 64 for sprites)"),
      style: z.string().optional().describe("Style: pixel-art (default for sprites), cartoon, etc."),
    }),
    execute: async ({ gameId, prompt, filename, width, height, style }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const provider = getImageProvider();

      // Default to pixel-art style and small dimensions for sprites
      const spriteStyle = style ?? "pixel-art";
      const spriteWidth = width ?? 64;
      const spriteHeight = height ?? 64;

      const result = await provider.generate(
        `Game sprite, transparent background: ${prompt}`,
        { width: spriteWidth, height: spriteHeight, style: spriteStyle },
      );

      const name = filename ?? `sprite_${nanoid(8)}`;
      const ext = "png";
      const relPath = `assets/sprites/${name}.${ext}`;
      const gameDir = path.join(ctx.workspacePath, "games", gameId);
      const absPath = path.join(gameDir, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      const asset: GameAsset = {
        id: nanoid(12),
        gameId,
        type: "sprite",
        name: `${name}.${ext}`,
        path: relPath,
        generatedBy: provider.type === "procedural" ? "procedural" : "ai-image",
        prompt,
        createdAt: new Date().toISOString(),
      };

      return JSON.stringify({
        asset,
        provider: result.provider,
        size: result.data.length,
        path: relPath,
      }, null, 2);
    },
  });
}
