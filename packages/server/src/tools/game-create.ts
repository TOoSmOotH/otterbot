import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { createGame } from "../games/game-service.js";
import { GameEngine } from "@otterbot/shared";

export function createGameCreateTool(ctx: ToolContext) {
  return tool({
    description:
      "Create a new game project from a template. Scaffolds the directory structure, copies starter files, and creates a game manifest. Use game_list_templates first to see available templates.",
    parameters: z.object({
      name: z.string().describe("Name of the game"),
      description: z.string().optional().describe("Short description of the game"),
      engine: z
        .enum(["threejs", "babylonjs", "phaser", "playcanvas", "canvas", "custom"])
        .describe("Game engine to use"),
      templateId: z.string().optional().describe("Template ID to use (defaults to <engine>-basic)"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
    }),
    execute: async ({ name, description, engine, templateId, tags }) => {
      const manifest = createGame(ctx.workspacePath, {
        name,
        description,
        engine: engine as GameEngine,
        templateId,
        projectId: ctx.projectId,
        tags,
      });
      return JSON.stringify(manifest, null, 2);
    },
  });
}
