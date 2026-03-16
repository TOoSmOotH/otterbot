import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getModelProvider } from "../games/asset-providers/asset-adapter.js";
import { getGame } from "../games/game-service.js";
import type { GameAsset } from "@otterbot/shared";

export function createGameGenModelTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a 3D model (GLB format) for a game. Currently uses procedural generation " +
      "for basic shapes (cube, sphere, cylinder, plane) with color. " +
      "AI model generation available when Replicate is configured. Saves to assets/models/.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to add the model to"),
      prompt: z.string().describe("Description of the 3D model (e.g. 'red cube', 'blue sphere', 'green cylinder')"),
      filename: z.string().optional().describe("Output filename (without extension)"),
      format: z.enum(["glb", "gltf", "obj"]).optional().describe("Output format (default: glb)"),
    }),
    execute: async ({ gameId, prompt, filename, format }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const provider = getModelProvider();
      const result = await provider.generate(prompt, { format });

      const name = filename ?? `model_${nanoid(8)}`;
      const ext = result.format;
      const relPath = `assets/models/${name}.${ext}`;
      const gameDir = path.join(ctx.workspacePath, "games", gameId);
      const absPath = path.join(gameDir, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      const asset: GameAsset = {
        id: nanoid(12),
        gameId,
        type: "model",
        name: `${name}.${ext}`,
        path: relPath,
        generatedBy: provider.type === "procedural" ? "procedural" : "ai-model",
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
