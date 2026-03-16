import { tool } from "ai";
import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ToolContext } from "./tool-context.js";
import { getVideo, updateManifest, getVideoDir } from "../video/video-service.js";

/**
 * Attempt to synthesize TTS narration using the configured provider.
 * Falls back to creating a silent placeholder if TTS is unavailable.
 */
async function synthesizeOrPlaceholder(
  text: string,
  outputPath: string,
): Promise<{ durationMs: number; usedTts: boolean }> {
  try {
    const { getConfiguredTTSProvider } = await import("../tts/tts.js");
    const { getConfig } = await import("../auth/auth.js");
    const { getAudioDurationMs } = await import("./demo-ffmpeg.js");

    const provider = getConfiguredTTSProvider();
    if (provider) {
      const voice = getConfig("tts:voice") ?? "af_heart";
      const speed = parseFloat(getConfig("tts:speed") ?? "1.0") || 1.0;
      const { audio } = await provider.synthesize(text, voice, speed);
      writeFileSync(outputPath, audio);
      const durationMs = await getAudioDurationMs(outputPath);
      return { durationMs, usedTts: true };
    }
  } catch {
    // TTS not available — fall through to placeholder
  }

  // Create a silent WAV placeholder (1 second per ~15 words)
  const wordCount = text.split(/\s+/).length;
  const durationSec = Math.max(2, Math.ceil(wordCount / 2.5));
  const durationMs = durationSec * 1000;

  // Minimal WAV header for silence (16-bit PCM, 22050 Hz, mono)
  const sampleRate = 22050;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize); // WAV header + silent samples

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Samples are all zeros (silence)

  writeFileSync(outputPath, buffer);
  return { durationMs, usedTts: false };
}

export function createVideoGenNarrationTool(ctx: ToolContext) {
  return tool({
    description:
      "Generate TTS narration audio for a video scene. Reads the scene's narration text and " +
      "produces an audio file. If TTS is not configured, creates a silent placeholder.",
    parameters: z.object({
      videoId: z.string().describe("The video project ID"),
      sceneId: z.string().describe("The scene ID to generate narration for"),
    }),
    execute: async ({ videoId, sceneId }) => {
      try {
        const manifest = getVideo(ctx.workspacePath, videoId);
        if (!manifest) return `Error: Video '${videoId}' not found.`;

        const scene = manifest.scenes.find((s) => s.id === sceneId);
        if (!scene) return `Error: Scene '${sceneId}' not found in video '${videoId}'.`;

        if (!scene.narration) {
          return `Error: Scene '${sceneId}' has no narration text. Add narration text first via video_add_scene.`;
        }

        const videoDir = getVideoDir(ctx.workspacePath, videoId);
        const audioRelPath = `assets/narration_${sceneId}.wav`;
        const audioAbsPath = resolve(videoDir, audioRelPath);

        const { durationMs, usedTts } = await synthesizeOrPlaceholder(scene.narration, audioAbsPath);

        // Update the scene's narrationAudioPath in the manifest
        scene.narrationAudioPath = audioRelPath;
        if (!scene.duration) {
          scene.duration = Math.ceil(durationMs / 1000) + 1; // Add 1s buffer
        }
        updateManifest(ctx.workspacePath, videoId, { scenes: manifest.scenes });

        const method = usedTts ? "TTS" : "silent placeholder";
        return (
          `Narration audio generated (${method}) for scene '${sceneId}'.\n` +
          `Audio: ${audioRelPath} (${(durationMs / 1000).toFixed(1)}s)\n` +
          `Text: "${scene.narration.slice(0, 100)}${scene.narration.length > 100 ? "..." : ""}"`
        );
      } catch (err) {
        return `Error generating narration: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
