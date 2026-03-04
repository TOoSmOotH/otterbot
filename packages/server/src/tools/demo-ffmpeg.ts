/**
 * FFmpeg helpers for demo video post-processing.
 *
 * Handles merging narration audio segments with video and converting
 * Playwright WebM recordings to YouTube-friendly MP4.
 *
 * Uses the same child_process.spawn pattern as stt/audio-utils.ts.
 */

import { spawn } from "node:child_process";

export interface NarrationSegment {
  /** Millisecond offset from start of recording */
  timestamp: number;
  /** Absolute path to the audio file (WAV or MP3) */
  audioPath: string;
  /** Audio duration in milliseconds */
  duration: number;
}

/**
 * Convert a WebM video to MP4 (no audio track).
 * Re-encodes the video stream with libx264 for broad compatibility.
 */
export function convertToMp4(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return runFfmpeg([
    "-i", inputPath,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-an",
    "-y",
    outputPath,
  ]);
}

/**
 * Merge a WebM video with timestamped narration audio segments into an MP4.
 *
 * Uses FFmpeg's complex filter graph to place each audio segment at its
 * correct timestamp, mix them into a single audio track, and mux with video.
 */
export function mergeVideoAndNarration(
  videoPath: string,
  segments: NarrationSegment[],
  outputPath: string,
): Promise<void> {
  if (segments.length === 0) {
    return convertToMp4(videoPath, outputPath);
  }

  // Build FFmpeg command with complex filter graph:
  // - Input 0: the video file
  // - Inputs 1..N: each narration audio segment
  // - adelay filter: offset each audio segment to its timestamp
  // - amix: combine all delayed audio streams into one

  const inputArgs: string[] = ["-i", videoPath];
  const filterParts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    inputArgs.push("-i", segments[i].audioPath);

    // adelay takes delay in ms, applied to all channels (left|right)
    const delayMs = segments[i].timestamp;
    filterParts.push(`[${i + 1}:a]adelay=${delayMs}|${delayMs}[a${i}]`);
  }

  // Mix all delayed audio streams together
  const mixInputs = segments.map((_, i) => `[a${i}]`).join("");
  filterParts.push(
    `${mixInputs}amix=inputs=${segments.length}:duration=longest:dropout_transition=0[aout]`,
  );

  const filterGraph = filterParts.join(";");

  return runFfmpeg([
    ...inputArgs,
    "-filter_complex", filterGraph,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-y",
    outputPath,
  ]);
}

/**
 * Get the duration of an audio file in milliseconds.
 */
export function getAudioDurationMs(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      audioPath,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    ffprobe.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    ffprobe.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const seconds = parseFloat(stdout.trim());
      if (isNaN(seconds)) {
        reject(new Error(`ffprobe returned non-numeric duration: ${stdout.trim()}`));
        return;
      }
      resolve(Math.round(seconds * 1000));
    });

    ffprobe.on("error", (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/** Run an FFmpeg command and return a promise that resolves on success. */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1000)}`));
        return;
      }
      resolve();
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}
