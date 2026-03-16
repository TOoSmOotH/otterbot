import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { createVideo } from "../video/video-service.js";

export function createVideoCreateTool(ctx: ToolContext) {
  return tool({
    description:
      "Create a new video project. Sets up directory structure and manifest for composing scenes into a final video.",
    parameters: z.object({
      name: z.string().describe("Name of the video project"),
      description: z.string().optional().describe("Short description of the video"),
      aspectRatio: z
        .enum(["16:9", "9:16", "1:1"])
        .optional()
        .describe("Aspect ratio (default: 16:9)"),
      resolution: z
        .enum(["720p", "1080p"])
        .optional()
        .describe("Video resolution (default: 1080p)"),
    }),
    execute: async ({ name, description, aspectRatio, resolution }) => {
      const manifest = createVideo(ctx.workspacePath, {
        name,
        description,
        aspectRatio,
        resolution,
        projectId: ctx.projectId,
      });
      return JSON.stringify(manifest, null, 2);
    },
  });
}
