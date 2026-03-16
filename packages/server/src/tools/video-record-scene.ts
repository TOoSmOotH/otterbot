import { tool } from "ai";
import { z } from "zod";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolContext } from "./tool-context.js";
import { getVideo, updateManifest, getVideoDir } from "../video/video-service.js";
import { getBrowser, createRecordingBrowserContext } from "./browser-pool.js";
import { convertToMp4 } from "./demo-ffmpeg.js";

export function createVideoRecordSceneTool(ctx: ToolContext) {
  return tool({
    description:
      "Record a screen capture for a screen-record scene. Uses a headless browser to navigate " +
      "to the scene's URL, records for the specified duration, and saves the result as a video clip.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID"),
      sceneId: z.string().describe("The scene ID to record"),
      duration: z
        .number()
        .optional()
        .describe("Recording duration in seconds (default: 10)"),
    }),
    execute: async ({ videoId, sceneId, duration }) => {
      try {
        const manifest = getVideo(ctx.workspacePath, videoId);
        if (!manifest) return `Error: Video '${videoId}' not found.`;

        const scene = manifest.scenes.find((s) => s.id === sceneId);
        if (!scene) return `Error: Scene '${sceneId}' not found.`;
        if (scene.type !== "screen-record") {
          return `Error: Scene '${sceneId}' is not a screen-record scene (type: ${scene.type}).`;
        }

        const recordDuration = duration ?? scene.duration ?? 10;
        const videoDir = getVideoDir(ctx.workspacePath, videoId);
        const clipsDir = resolve(videoDir, "clips");
        const recordDir = resolve(videoDir, "clips", `record_${sceneId}`);

        // Create recording browser context
        const context = await createRecordingBrowserContext(recordDir, {
          width: manifest.resolution === "1080p" ? 1920 : 1280,
          height: manifest.resolution === "1080p" ? 1080 : 720,
        });

        const page = await context.newPage();

        try {
          // Navigate to the scene URL
          await page.goto(scene.url, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });

          // Wait for the recording duration
          await page.waitForTimeout(recordDuration * 1000);

          // Close to finalize the video
          await page.close();
          await context.close();
        } catch (err) {
          // Ensure cleanup on error
          try { await page.close(); } catch { /* ignore */ }
          try { await context.close(); } catch { /* ignore */ }
          throw err;
        }

        // Find the recorded WebM file
        const webmFiles = readdirSync(recordDir).filter((f) => f.endsWith(".webm"));
        if (webmFiles.length === 0) {
          return "Error: No video file was recorded. The browser may have failed to capture.";
        }

        const webmPath = resolve(recordDir, webmFiles[0]);
        const mp4RelPath = `clips/${sceneId}.mp4`;
        const mp4AbsPath = resolve(videoDir, mp4RelPath);

        // Convert WebM to MP4
        await convertToMp4(webmPath, mp4AbsPath);

        // Update scene manifest
        scene.videoClipPath = mp4RelPath;
        if (!scene.duration) {
          scene.duration = recordDuration;
        }
        updateManifest(ctx.workspacePath, videoId, { scenes: manifest.scenes });

        return (
          `Screen recording complete for scene '${sceneId}'.\n` +
          `URL: ${scene.url}\n` +
          `Duration: ${recordDuration}s\n` +
          `Clip: ${mp4RelPath}`
        );
      } catch (err) {
        return `Error recording scene: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
