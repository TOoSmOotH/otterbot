import { tool } from "ai";
import { z } from "zod";
import { statSync } from "node:fs";
import type { ToolContext } from "./tool-context.js";
import { getVideo, updateManifest, getVideoDir } from "../video/video-service.js";
import { renderVideo } from "../video/video-compositor.js";
import { getAudioDurationMs } from "./demo-ffmpeg.js";

export function createVideoRenderTool(ctx: ToolContext) {
  return tool({
    description:
      "Render a video project into a final MP4 file. Composites all scenes (titles, slides, " +
      "screen recordings) with narration audio into a single output video.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID to render"),
    }),
    execute: async ({ videoId }) => {
      try {
        const manifest = getVideo(ctx.workspacePath, videoId);
        if (!manifest) return `Error: Video '${videoId}' not found.`;

        if (manifest.scenes.length === 0) {
          return "Error: Video has no scenes. Add scenes first with video_add_scene.";
        }

        // Update status to compositing
        updateManifest(ctx.workspacePath, videoId, { status: "compositing" });

        const videoDir = getVideoDir(ctx.workspacePath, videoId);

        try {
          const outputPath = await renderVideo(videoDir, manifest);

          // Get output file stats for duration estimate
          const stats = statSync(outputPath);
          const totalDuration = manifest.scenes.reduce(
            (sum, s) => sum + (s.duration ?? 5),
            0,
          );

          // Update manifest with output info
          const updated = updateManifest(ctx.workspacePath, videoId, {
            status: "complete",
            outputPath: "output.mp4",
            duration: totalDuration,
          });

          return (
            `Video rendered successfully!\n` +
            `Output: ${outputPath}\n` +
            `Duration: ~${totalDuration}s\n` +
            `Size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB\n` +
            `Scenes: ${manifest.scenes.length}\n` +
            `Resolution: ${manifest.resolution} (${manifest.aspectRatio})`
          );
        } catch (err) {
          updateManifest(ctx.workspacePath, videoId, { status: "failed" });
          throw err;
        }
      } catch (err) {
        return `Error rendering video: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
