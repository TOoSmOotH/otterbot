/**
 * Procedural sound generation — no AI required.
 *
 * Generates simple WAV sounds: sine tones, noise, chiptune-style effects.
 * Works as a zero-dependency fallback when no AI sound provider is configured.
 */

import type { SoundGenProvider, SoundGenOptions, SoundGenResult } from "./types.js";

const SAMPLE_RATE = 44100;

function detectSoundType(prompt: string): "tone" | "noise" | "sweep" | "beep" | "explosion" {
  const lower = prompt.toLowerCase();
  if (lower.includes("explo") || lower.includes("boom") || lower.includes("crash")) return "explosion";
  if (lower.includes("beep") || lower.includes("click") || lower.includes("coin") || lower.includes("pickup")) return "beep";
  if (lower.includes("sweep") || lower.includes("laser") || lower.includes("whoosh")) return "sweep";
  if (lower.includes("noise") || lower.includes("wind") || lower.includes("rain") || lower.includes("static")) return "noise";
  return "tone";
}

function generateSamples(prompt: string, durationSeconds: number): Float32Array {
  const numSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(numSamples);
  const type = detectSoundType(prompt);

  // Seed PRNG from prompt
  let seed = 0;
  for (let i = 0; i < prompt.length; i++) seed = ((seed << 5) - seed + prompt.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) | 0;
    return ((seed >>> 16) & 0x7fff) / 0x7fff;
  };

  // Base frequency from prompt hash
  const baseFreq = 200 + (Math.abs(seed) % 600);

  switch (type) {
    case "tone": {
      for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const envelope = Math.min(1, 20 * t) * Math.max(0, 1 - t / durationSeconds);
        samples[i] = Math.sin(2 * Math.PI * baseFreq * t) * envelope * 0.5;
      }
      break;
    }
    case "beep": {
      const freq = 800 + (Math.abs(seed) % 800);
      for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const envelope = Math.max(0, 1 - t / (durationSeconds * 0.3));
        samples[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.6;
      }
      break;
    }
    case "sweep": {
      const startFreq = 1200;
      const endFreq = 100;
      for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const progress = t / durationSeconds;
        const freq = startFreq + (endFreq - startFreq) * progress;
        const envelope = Math.max(0, 1 - progress);
        samples[i] = Math.sin(2 * Math.PI * freq * t) * envelope * 0.5;
      }
      break;
    }
    case "noise": {
      for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const envelope = Math.min(1, 5 * t) * Math.max(0, 1 - t / durationSeconds);
        samples[i] = (rand() * 2 - 1) * envelope * 0.3;
      }
      break;
    }
    case "explosion": {
      for (let i = 0; i < numSamples; i++) {
        const t = i / SAMPLE_RATE;
        const envelope = Math.max(0, 1 - t / durationSeconds) ** 2;
        // Low rumble + noise
        const rumble = Math.sin(2 * Math.PI * 60 * t) * 0.5;
        const noise = (rand() * 2 - 1) * 0.5;
        samples[i] = (rumble + noise) * envelope * 0.7;
      }
      break;
    }
  }

  return samples;
}

function encodeWAV(samples: Float32Array): Buffer {
  const numSamples = samples.length;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = SAMPLE_RATE * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;

  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);

  // fmt chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  // Write samples as 16-bit PCM
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  return buf;
}

export class ProceduralSoundProvider implements SoundGenProvider {
  type = "procedural" as const;

  async generate(prompt: string, options?: SoundGenOptions): Promise<SoundGenResult> {
    const duration = options?.durationSeconds ?? (options?.category === "music" ? 5 : 1);
    const samples = generateSamples(prompt, duration);
    const data = encodeWAV(samples);
    return { data, format: "wav", provider: "procedural" };
  }
}
