import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import { getSoundProvider } from "../games/asset-providers/asset-adapter.js";
import { getGame } from "../games/game-service.js";
import type { GameAsset } from "@otterbot/shared";

export function createGameGenSoundTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate a sound effect or music clip for a game. Currently uses procedural synthesis " +
      "for basic sounds (tones, beeps, explosions, sweeps, noise). " +
      "Saves WAV files to assets/sounds/.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to add the sound to"),
      prompt: z.string().describe("Description of the sound (e.g. 'coin pickup beep', 'explosion boom', 'laser sweep')"),
      filename: z.string().optional().describe("Output filename (without extension)"),
      durationSeconds: z.number().optional().describe("Duration in seconds (default: 1 for SFX, 5 for music)"),
      category: z.enum(["sfx", "music", "ambient"]).optional().describe("Sound category (default: sfx)"),
    }),
    execute: async ({ gameId, prompt, filename, durationSeconds, category }) => {
      const game = getGame(ctx.workspacePath, gameId);
      if (!game) return JSON.stringify({ error: `Game ${gameId} not found` });

      const provider = getSoundProvider();
      const result = await provider.generate(prompt, { durationSeconds, category });

      const name = filename ?? `sound_${nanoid(8)}`;
      const ext = result.format;
      const relPath = `assets/sounds/${name}.${ext}`;
      const gameDir = path.join(ctx.workspacePath, "games", gameId);
      const absPath = path.join(gameDir, relPath);

      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, result.data);

      const asset: GameAsset = {
        id: nanoid(12),
        gameId,
        type: "sound",
        name: `${name}.${ext}`,
        path: relPath,
        generatedBy: provider.type === "procedural" ? "procedural" : "ai-sound",
        prompt,
        createdAt: new Date().toISOString(),
      };

      return JSON.stringify({
        asset,
        provider: result.provider,
        size: result.data.length,
        path: relPath,
        durationSeconds: durationSeconds ?? (category === "music" ? 5 : 1),
      }, null, 2);
    },
  });
}
