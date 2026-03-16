import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { buildGame, getGame } from "../games/game-service.js";

export function createGameBuildTool(ctx: ToolContext) {
  return tool({
    description:
      "Build a game project, copying source files into a self-contained dist/ directory ready to play. Updates the game status to 'playable' on success.",
    parameters: z.object({
      gameId: z.string().describe("The game ID to build"),
    }),
    execute: async ({ gameId }) => {
      const result = buildGame(ctx.workspacePath, gameId);
      if (!result.ok) {
        return JSON.stringify({ error: result.error });
      }
      const manifest = getGame(ctx.workspacePath, gameId);
      return JSON.stringify({ ok: true, game: manifest }, null, 2);
    },
  });
}
