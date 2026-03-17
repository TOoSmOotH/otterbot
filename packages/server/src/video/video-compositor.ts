/**
 * Video compositor — FFmpeg pipeline for rendering video projects.
 *
 * Converts scenes (slides, titles, screen recordings) into individual clips,
 * then concatenates them into a final MP4. Uses its own runFfmpeg helper
 * since the one in demo-ffmpeg.ts is not exported.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import type { VideoManifest, VideoAudioTrack } from "@otterbot/shared";

/** Run an FFmpeg command and return a promise */
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

/** Get resolution dimensions from resolution string */
function getResolution(resolution: "720p" | "1080p"): { width: number; height: number } {
  return resolution === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
}

/** Create a video clip from a still image */
export async function createSlideClip(
  imagePath: string,
  duration: number,
  outputPath: string,
  width: number,
  height: number,
  audioPath?: string,
): Promise<void> {
  const args = [
    "-loop", "1", "-i", imagePath,
    ...(audioPath ? ["-i", audioPath] : []),
    "-c:v", "libx264", "-t", String(duration),
    "-pix_fmt", "yuv420p",
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    ...(audioPath ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : ["-an"]),
    "-y", outputPath,
  ];
  await runFfmpeg(args);
}

/** Create a title card clip with text */
export async function createTitleClip(
  text: string,
  subtitle: string | undefined,
  bgColor: string,
  duration: number,
  outputPath: string,
  width: number,
  height: number,
  audioPath?: string,
): Promise<void> {
  const escapedText = text.replace(/'/g, "'\\''").replace(/:/g, "\\:");
  const escapedSub = subtitle ? subtitle.replace(/'/g, "'\\''").replace(/:/g, "\\:") : "";

  let filterComplex = `color=c=${bgColor}:s=${width}x${height}:d=${duration},drawtext=text='${escapedText}':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40`;
  if (subtitle) {
    filterComplex += `,drawtext=text='${escapedSub}':fontsize=30:fontcolor=gray:x=(w-text_w)/2:y=(h-text_h)/2+40`;
  }

  const args = [
    ...(audioPath ? ["-i", audioPath] : []),
    "-f", "lavfi", "-i", filterComplex,
    "-c:v", "libx264", "-t", String(duration), "-pix_fmt", "yuv420p",
    ...(audioPath ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : ["-an"]),
    "-y", outputPath,
  ];
  await runFfmpeg(args);
}

/** Concatenate video clips with optional transitions */
export async function concatenateClips(
  clipPaths: string[],
  outputPath: string,
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("No clips to concatenate");
  if (clipPaths.length === 1) {
    fs.copyFileSync(clipPaths[0], outputPath);
    return;
  }

  // Use concat demuxer for simple concatenation
  const listFile = outputPath + ".txt";
  const lines = clipPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(listFile, lines);

  try {
    await runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-y", outputPath,
    ]);
  } finally {
    try {
      fs.unlinkSync(listFile);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mix global audio tracks (background music, ambient, SFX) into a video.
 *
 * Builds an FFmpeg complex filter graph that:
 * - Extracts existing audio from the video (narration) and applies narrationVolume
 * - Adds each audio track with volume, looping, delay, and fade filters
 * - Mixes all audio streams together
 */
async function mixGlobalAudio(
  videoPath: string,
  videoDir: string,
  audioTracks: VideoAudioTrack[],
  narrationVolume: number,
  musicVolume: number,
  outputPath: string,
): Promise<void> {
  // Input 0 is the video file (may contain narration audio)
  const inputArgs = ["-i", videoPath];
  const filterParts: string[] = [];
  const audioLabels: string[] = [];
  let inputIndex = 1;

  // Extract and scale existing audio (narration) from the video
  filterParts.push(`[0:a]volume=${narrationVolume}[narration]`);
  audioLabels.push("[narration]");

  // Add each audio track as an input
  for (const track of audioTracks) {
    const trackPath = path.join(videoDir, track.audioPath);
    if (!fs.existsSync(trackPath)) continue;

    inputArgs.push("-i", trackPath);
    const idx = inputIndex++;
    let label = `[${idx}:a]`;
    const filters: string[] = [];

    // Volume: apply per-track volume scaled by global musicVolume
    const vol = (track.volume ?? 1.0) * (track.type === "background-music" || track.type === "ambient" ? musicVolume : 1.0);
    filters.push(`volume=${vol}`);

    // Loop if needed — repeat audio enough times to cover the video
    if (track.loop) {
      // aloop: loop=-1 means infinite, but we use a large count; nsamples=0 uses full input
      filters.push("aloop=loop=-1:size=2147483647");
    }

    // Delay if startTime is set (adelay takes milliseconds)
    if (track.startTime && track.startTime > 0) {
      const delayMs = Math.round(track.startTime * 1000);
      filters.push(`adelay=${delayMs}|${delayMs}`);
    }

    // Fade in
    if (track.fadeIn && track.fadeIn > 0) {
      filters.push(`afade=t=in:d=${track.fadeIn}`);
    }

    // Fade out
    if (track.fadeOut && track.fadeOut > 0) {
      filters.push(`afade=t=out:st=0:d=${track.fadeOut}`);
    }

    const trackLabel = `a_track${idx}`;
    filterParts.push(`${label}${filters.join(",")}[${trackLabel}]`);
    audioLabels.push(`[${trackLabel}]`);
  }

  if (audioLabels.length <= 1) {
    // No valid audio tracks to mix — just copy
    fs.copyFileSync(videoPath, outputPath);
    return;
  }

  // Mix all audio streams
  const mixInputs = audioLabels.join("");
  filterParts.push(
    `${mixInputs}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0[aout]`,
  );

  const filterGraph = filterParts.join(";");

  await runFfmpeg([
    ...inputArgs,
    "-filter_complex", filterGraph,
    "-map", "0:v",
    "-map", "[aout]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k",
    "-y", outputPath,
  ]);
}

/** Render a complete video from its manifest */
export async function renderVideo(
  videoDir: string,
  manifest: VideoManifest,
): Promise<string> {
  const { width, height } = getResolution(manifest.resolution);
  const clipsDir = path.join(videoDir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  const clipPaths: string[] = [];

  for (let i = 0; i < manifest.scenes.length; i++) {
    const scene = manifest.scenes[i];
    const clipPath = path.join(clipsDir, `scene_${i}.mp4`);
    const duration = scene.duration ?? 5;

    switch (scene.type) {
      case "slide":
        await createSlideClip(
          path.join(videoDir, scene.imagePath),
          duration,
          clipPath,
          width,
          height,
          scene.narrationAudioPath ? path.join(videoDir, scene.narrationAudioPath) : undefined,
        );
        break;
      case "title":
        await createTitleClip(
          scene.text,
          scene.subtitle,
          scene.backgroundColor ?? "black",
          duration,
          clipPath,
          width,
          height,
          scene.narrationAudioPath ? path.join(videoDir, scene.narrationAudioPath) : undefined,
        );
        break;
      case "screen-record":
        if (scene.videoClipPath) {
          const srcPath = path.join(videoDir, scene.videoClipPath);
          await runFfmpeg([
            "-i", srcPath,
            "-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p",
            "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
            ...(scene.narrationAudioPath
              ? ["-i", path.join(videoDir, scene.narrationAudioPath), "-c:a", "aac", "-b:a", "192k"]
              : ["-an"]),
            "-y", clipPath,
          ]);
        } else {
          await createTitleClip(
            "Screen Recording",
            scene.url,
            "0x333333",
            duration,
            clipPath,
            width,
            height,
          );
        }
        break;
    }
    clipPaths.push(clipPath);
  }

  // Concatenate scene clips
  const hasAudioTracks = manifest.audioTracks && manifest.audioTracks.length > 0;
  const concatenatedPath = hasAudioTracks
    ? path.join(clipsDir, "concatenated.mp4")
    : path.join(videoDir, "output.mp4");

  await concatenateClips(clipPaths, concatenatedPath);

  // Mix global audio tracks if present
  if (hasAudioTracks) {
    const outputPath = path.join(videoDir, "output.mp4");
    try {
      await mixGlobalAudio(
        concatenatedPath,
        videoDir,
        manifest.audioTracks!,
        manifest.narrationVolume ?? 1.0,
        manifest.musicVolume ?? 0.3,
        outputPath,
      );
    } catch {
      // If mixing fails (e.g. no audio stream in concatenated video), fall back
      fs.copyFileSync(concatenatedPath, outputPath);
    }
    // Clean up intermediate file
    try { fs.unlinkSync(concatenatedPath); } catch { /* ignore */ }
    return outputPath;
  }

  return concatenatedPath;
}
