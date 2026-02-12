/**
 * Audio decoding utility — converts incoming audio (WebM/Opus from MediaRecorder)
 * to 16kHz mono Float32Array for Whisper using ffmpeg.
 */

import { spawn } from "node:child_process";

export function decodeToFloat32(input: Buffer): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-f", "f32le",
      "-ar", "16000",
      "-ac", "1",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      resolve(new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4));
    });

    ffmpeg.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });

    ffmpeg.stdin.write(input);
    ffmpeg.stdin.end();
  });
}
