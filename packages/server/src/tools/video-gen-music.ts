import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import type { VideoAudioTrack } from "@otterbot/shared";
import { getVideo, updateManifest, getVideoDir } from "../video/video-service.js";
import { getSoundProvider } from "../asset-providers/asset-adapter.js";

export function createVideoGenMusicTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate background music, ambient sound, or sound effects for a video project. " +
      "Uses AI (Replicate) or procedural synthesis depending on configuration. " +
      "Adds the generated audio as a track in the video manifest.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID"),
      prompt: z.string().describe("Description of desired audio (e.g. 'upbeat corporate background music', 'dramatic orchestral intro')"),
      durationSeconds: z.number().optional().describe("Duration in seconds; if omitted, computes from total scene durations"),
      category: z.enum(["background-music", "sfx", "ambient"]).optional().describe("Audio track type (default: background-music)"),
      volume: z.number().min(0).max(1).optional().describe("Volume level 0.0-1.0 (default: 0.3 for music, 1.0 for sfx)"),
      loop: z.boolean().optional().describe("Whether to loop if shorter than video duration"),
      fadeIn: z.number().optional().describe("Fade-in duration in seconds"),
      fadeOut: z.number().optional().describe("Fade-out duration in seconds"),
      mood: z.string().optional().describe("Mood hint (e.g. 'upbeat', 'melancholy', 'tense')"),
      style: z.string().optional().describe("Genre/style hint (e.g. 'chiptune', 'orchestral', 'lo-fi', 'electronic')"),
    }),
    execute: async ({ videoId, prompt, durationSeconds, category, volume, loop, fadeIn, fadeOut, mood, style }) => {
      try {
        const manifest = getVideo(ctx.workspacePath, videoId);
        if (!manifest) return `Error: Video '${videoId}' not found.`;

        const trackType = category ?? "background-music";

        // Compute duration from scenes if not provided
        let duration = durationSeconds;
        if (!duration) {
          const totalSceneDuration = manifest.scenes.reduce((sum, s) => sum + (s.duration ?? 5), 0);
          duration = totalSceneDuration || 10;
        }

        // Map track type to sound provider category
        const soundCategory = trackType === "background-music" ? "music" as const
          : trackType === "ambient" ? "ambient" as const
          : "sfx" as const;

        const provider = getSoundProvider();
        const result = await provider.generate(prompt, {
          durationSeconds: duration,
          category: soundCategory,
          mood,
          style,
        });

        // Write audio file
        const videoDir = getVideoDir(ctx.workspacePath, videoId);
        const filename = `music_${nanoid(8)}.${result.format}`;
        const relPath = `assets/${filename}`;
        const absPath = path.join(videoDir, relPath);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, result.data);

        // Create audio track entry
        const track: VideoAudioTrack = {
          id: nanoid(12),
          type: trackType,
          audioPath: relPath,
          volume: volume ?? (trackType === "background-music" ? 0.3 : trackType === "ambient" ? 0.4 : 1.0),
          loop,
          fadeIn,
          fadeOut,
          prompt,
        };

        const audioTracks = [...(manifest.audioTracks ?? []), track];
        updateManifest(ctx.workspacePath, videoId, { audioTracks });

        return JSON.stringify({
          trackId: track.id,
          type: track.type,
          audioPath: relPath,
          durationSeconds: duration,
          volume: track.volume,
          loop: track.loop,
          provider: result.provider,
          size: result.data.length,
        }, null, 2);
      } catch (err) {
        return `Error generating music: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
