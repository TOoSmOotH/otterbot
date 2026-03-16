import { tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import type { VideoScene } from "@otterbot/shared";
import { addScene } from "../video/video-service.js";

export function createVideoAddSceneTool(ctx: ToolContext) {
  return tool({
    description:
      "Add a scene to an existing video project. Scenes are appended to the end of the scene list. " +
      "Types: 'title' for text cards, 'slide' for image-based scenes, 'screen-record' for web app captures.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID"),
      type: z
        .enum(["slide", "screen-record", "title"])
        .describe("Scene type"),
      imagePath: z
        .string()
        .optional()
        .describe("Relative path to image file within the video directory (for slide scenes)"),
      text: z
        .string()
        .optional()
        .describe("Title text (for title scenes)"),
      subtitle: z
        .string()
        .optional()
        .describe("Subtitle text (for title scenes)"),
      url: z
        .string()
        .optional()
        .describe("URL to record (for screen-record scenes)"),
      narration: z
        .string()
        .optional()
        .describe("Narration text for TTS voiceover"),
      duration: z
        .number()
        .optional()
        .describe("Scene duration in seconds (default: 5)"),
      transition: z
        .enum(["fade", "dissolve", "cut", "slide-left"])
        .optional()
        .describe("Transition effect to next scene"),
      backgroundColor: z
        .string()
        .optional()
        .describe("Background color for title scenes (default: black)"),
      textOverlay: z
        .string()
        .optional()
        .describe("Text overlay for slide scenes"),
    }),
    execute: async ({ videoId, type, imagePath, text, subtitle, url, narration, duration, transition, backgroundColor, textOverlay }) => {
      try {
        const sceneId = nanoid(8);
        let scene: VideoScene;

        switch (type) {
          case "title":
            if (!text) return "Error: 'text' is required for title scenes.";
            scene = {
              type: "title",
              id: sceneId,
              text,
              subtitle,
              backgroundColor,
              duration,
              narration,
              transition,
            };
            break;
          case "slide":
            if (!imagePath) return "Error: 'imagePath' is required for slide scenes.";
            scene = {
              type: "slide",
              id: sceneId,
              imagePath,
              narration,
              duration,
              transition,
              textOverlay,
            };
            break;
          case "screen-record":
            if (!url) return "Error: 'url' is required for screen-record scenes.";
            scene = {
              type: "screen-record",
              id: sceneId,
              url,
              narration,
              duration,
              transition,
            };
            break;
        }

        const manifest = addScene(ctx.workspacePath, videoId, scene);
        return JSON.stringify({ message: `Scene '${sceneId}' added (${type})`, manifest }, null, 2);
      } catch (err) {
        return `Error adding scene: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
