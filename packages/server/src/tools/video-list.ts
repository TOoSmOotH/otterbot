import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { listVideos } from "../video/video-service.js";

export function createVideoListTool(ctx: ToolContext) {
  return tool({
    description:
      "List all video projects in the current workspace. Returns manifests with scene counts and status.",
    parameters: z.object({}),
    execute: async () => {
      const videos = listVideos(ctx.workspacePath, ctx.projectId);
      if (videos.length === 0) return "No video projects found.";
      return JSON.stringify(videos, null, 2);
    },
  });
}
