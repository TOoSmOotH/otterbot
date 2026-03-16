import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getImageProvider } from "../games/asset-providers/asset-adapter.js";
import { getGame, updateGame } from "../games/game-service.js";
import type { GameAsset } from "@otterbot/shared";

export function createGameGenTextureTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a texture image for a game using AI or procedural generation. " +
      "Saves the image to the game's assets/textures/ directory. " +
      "The provider is determined by the system's asset generation settings.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to add the texture to"),
      prompt: z.string().describe("Description of the texture to generate (e.g. 'brick wall texture', 'grass ground tile')"),
      filename: z.string().optional().describe("Output filename (without extension, defaults to a generated name)"),
      width: z.number().optional().describe("Width in pixels (default: 256)"),
      height: z.number().optional().describe("Height in pixels (default: 256)"),
      style: z.string().optional().describe("Style hint: pixel-art, photorealistic, cartoon, etc."),
    }),
    execute: async ({ gameId, prompt, filename, width, height, style }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const provider = getImageProvider();
      const result = await provider.generate(prompt, { width, height, style });

      // Save to game assets
      const name = filename ?? `texture_${nanoid(8)}`;
      const ext = result.mimeType === "image/png" ? "png" : "jpg";
      const relPath = `assets/textures/${name}.${ext}`;
      const gameDir = path.join(ctx.workspacePath, "games", gameId);
      const absPath = path.join(gameDir, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      const asset: GameAsset = {
        id: nanoid(12),
        gameId,
        type: "texture",
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
