import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { ToolContext } from "./tool-context.js";
import type { VideoAudioTrack } from "@otterbot/shared";
import { getVideo, updateManifest, getVideoDir } from "../video/video-service.js";

export function createVideoAddAudioTool(ctx: ToolContext) {
  return tool({
    description:
      "Add an existing audio file as a track to a video project. Use this to add pre-existing " +
      "music, sound effects, or ambient audio with precise timing and volume control.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID"),
      audioPath: z.string().describe("Path to the audio file (relative to video directory, or absolute)"),
      type: z.enum(["background-music", "sfx", "ambient"]).describe("Audio track type"),
      startTime: z.number().optional().describe("Start time offset in seconds from video start (default: 0)"),
      endTime: z.number().optional().describe("End time in seconds; if omitted, plays to end of audio"),
      volume: z.number().min(0).max(1).optional().describe("Volume level 0.0-1.0 (default: 0.3 for music, 1.0 for sfx)"),
      loop: z.boolean().optional().describe("Whether to loop if shorter than video duration"),
      fadeIn: z.number().optional().describe("Fade-in duration in seconds"),
      fadeOut: z.number().optional().describe("Fade-out duration in seconds"),
    }),
    execute: async ({ videoId, audioPath, type, startTime, endTime, volume, loop, fadeIn, fadeOut }) => {
      try {
        const manifest = getVideo(ctx.workspacePath, videoId);
        if (!manifest) return `Error: Video '${videoId}' not found.`;

        const videoDir = getVideoDir(ctx.workspacePath, videoId);

        // Resolve and verify audio file exists
        const absPath = path.isAbsolute(audioPath)
          ? audioPath
          : path.join(videoDir, audioPath);

        if (!fs.existsSync(absPath)) {
          return `Error: Audio file not found at '${absPath}'.`;
        }

        // Store relative path in manifest
        const relPath = path.isAbsolute(audioPath)
          ? path.relative(videoDir, audioPath)
          : audioPath;

        const track: VideoAudioTrack = {
          id: nanoid(12),
          type,
          audioPath: relPath,
          startTime,
          endTime,
          volume: volume ?? (type === "background-music" ? 0.3 : type === "ambient" ? 0.4 : 1.0),
          loop,
          fadeIn,
          fadeOut,
        };

        const audioTracks = [...(manifest.audioTracks ?? []), track];
        updateManifest(ctx.workspacePath, videoId, { audioTracks });

        return JSON.stringify({
          trackId: track.id,
          type: track.type,
          audioPath: relPath,
          volume: track.volume,
          startTime: track.startTime,
          loop: track.loop,
        }, null, 2);
      } catch (err) {
        return `Error adding audio track: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
