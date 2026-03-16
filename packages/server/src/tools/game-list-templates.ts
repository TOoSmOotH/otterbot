import { tool } from "ai";
import { z } from "zod";
import { listTemplates } from "../games/game-service.js";

export function createGameListTemplatesTool() {
  return tool({
    description:
      "List available game engine templates. Each template provides starter boilerplate for a specific engine (Three.js, Babylon.js, Phaser, PlayCanvas, or raw Canvas). Use this to choose the right engine before creating a game.",
    parameters: z.object({
      engine: z
        .enum(["threejs", "babylonjs", "phaser", "playcanvas", "canvas"])
        .optional()
        .describe("Filter templates by engine"),
    }),
    execute: async ({ engine }) => {
      let templates = listTemplates();
      if (engine) {
        templates = templates.filter((t) => t.engine === engine);
      }
      if (templates.length === 0) {
        return "No templates found.";
      }
      return JSON.stringify(templates, null, 2);
    },
  });
}
