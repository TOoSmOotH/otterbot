import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { listGames } from "../games/game-service.js";

export function createGameListTool(ctx: ToolContext) {
  return tool({
    description:
      "List all games in the current project workspace. Returns game manifests with name, engine, status, and metadata.",
    parameters: z.object({
      status: z
        .enum(["draft", "building", "playable", "testing", "published"])
        .optional()
        .describe("Filter by game status"),
    }),
    execute: async ({ status }) => {
      let games = listGames(ctx.workspacePath);
      if (status) {
        games = games.filter((g) => g.status === status);
      }
      if (games.length === 0) {
        return "No games found in this project.";
      }
      return JSON.stringify(games, null, 2);
    },
  });
}
