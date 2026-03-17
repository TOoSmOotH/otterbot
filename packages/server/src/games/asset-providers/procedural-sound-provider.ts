/**
 * Procedural sound generation — no AI required.
 *
 * Generates WAV audio: SFX (tones, beeps, sweeps, noise, explosions),
 * music (layered bass, chords, arpeggios, rhythm), and ambient soundscapes.
 * Works as a zero-dependency fallback when no AI sound provider is configured.
 */

import type { SoundGenProvider, SoundGenOptions, SoundGenResult } from "./types.js";

const SAMPLE_RATE = 44100;

// ---------------------------------------------------------------------------
// PRNG seeded from prompt text
// ---------------------------------------------------------------------------

function createPRNG(prompt: string): () => number {
  let seed = 0;
  for (let i = 0; i < prompt.length; i++) seed = ((seed << 5) - seed + prompt.charCodeAt(i)) | 0;
  return () => {
    seed = (seed * 1103515245 + 12345) | 0;
    return ((seed >>> 16) & 0x7fff) / 0x7fff;
  };
}

// ---------------------------------------------------------------------------
// Musical constants
// ---------------------------------------------------------------------------

const SEMITONE = Math.pow(2, 1 / 12);

function noteFreq(semitones: number, octaveShift = 0): number {
  return 440 * Math.pow(SEMITONE, semitones) * Math.pow(2, octaveShift);
}

const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  "minor-pentatonic": [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const PROGRESSIONS = [
  [0, 3, 4, 4],   // I-IV-V-V
  [0, 4, 5, 3],   // I-V-vi-IV
  [0, 3, 0, 4],   // I-IV-I-V
  [5, 3, 0, 4],   // vi-IV-I-V
  [0, 5, 3, 4],   // I-vi-IV-V
  [0, 2, 3, 4],   // I-iii-IV-V
];

const ROOT_NOTES: Record<string, number> = {
  C: -9, "C#": -8, D: -7, "D#": -6, Eb: -6, E: -5, F: -4,
  "F#": -3, G: -2, "G#": -1, Ab: -1, A: 0, "A#": 1, Bb: 1, B: 2,
};

// ---------------------------------------------------------------------------
// Waveform generators
// ---------------------------------------------------------------------------

function sine(phase: number): number {
  return Math.sin(2 * Math.PI * phase);
}

function triangle(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
}

function square(phase: number, duty = 0.5): number {
  const p = ((phase % 1) + 1) % 1;
  return p < duty ? 0.6 : -0.6;
}

function sawtooth(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return 2 * p - 1;
}

// ---------------------------------------------------------------------------
// Parse musical parameters from options + prompt
// ---------------------------------------------------------------------------

interface MusicParams {
  rootSemitone: number;
  scale: number[];
  tempo: number;
  progression: number[];
  rand: () => number;
  style: string;
}

function parseMusicParams(prompt: string, options?: SoundGenOptions): MusicParams {
  const rand = createPRNG(prompt);
  const lower = prompt.toLowerCase();

  let rootSemitone = 0;
  let scaleType = "minor";
  if (options?.key) {
    const parts = options.key.trim().split(/\s+/);
    const root = parts[0];
    if (ROOT_NOTES[root] !== undefined) rootSemitone = ROOT_NOTES[root];
    if (parts[1]?.toLowerCase().includes("maj")) scaleType = "major";
    else if (parts[1]?.toLowerCase().includes("min")) scaleType = "minor";
    else if (parts[1]?.toLowerCase().includes("pent")) scaleType = "pentatonic";
    else if (parts[1]?.toLowerCase().includes("blues")) scaleType = "blues";
    else if (parts[1]?.toLowerCase().includes("dor")) scaleType = "dorian";
  } else {
    const roots = Object.keys(ROOT_NOTES);
    rootSemitone = ROOT_NOTES[roots[Math.floor(rand() * roots.length)]];
    if (lower.includes("happy") || lower.includes("upbeat") || lower.includes("bright")) scaleType = "major";
    else if (lower.includes("sad") || lower.includes("melanchol") || lower.includes("dark")) scaleType = "minor";
    else if (lower.includes("blues") || lower.includes("funky")) scaleType = "blues";
    else if (lower.includes("asian") || lower.includes("zen") || lower.includes("meditat")) scaleType = "pentatonic";
    else scaleType = rand() < 0.5 ? "major" : "minor";
  }

  let tempo = options?.tempo ?? 0;
  if (!tempo) {
    if (options?.mood) {
      const m = options.mood.toLowerCase();
      if (m.includes("fast") || m.includes("upbeat") || m.includes("energetic")) tempo = 130 + Math.floor(rand() * 30);
      else if (m.includes("slow") || m.includes("calm") || m.includes("relax")) tempo = 70 + Math.floor(rand() * 20);
      else if (m.includes("tense") || m.includes("dramatic")) tempo = 100 + Math.floor(rand() * 20);
      else tempo = 90 + Math.floor(rand() * 40);
    } else {
      tempo = 80 + Math.floor(rand() * 60);
    }
  }

  const scale = SCALES[scaleType] ?? SCALES.minor;
  const progression = PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)];

  const style = options?.style ?? (
    lower.includes("chiptune") || lower.includes("8-bit") || lower.includes("retro") ? "chiptune" :
    lower.includes("orchestral") || lower.includes("cinematic") ? "orchestral" :
    lower.includes("lo-fi") || lower.includes("lofi") || lower.includes("chill") ? "lo-fi" :
    lower.includes("electronic") || lower.includes("synth") || lower.includes("edm") ? "electronic" :
    lower.includes("ambient") ? "ambient" :
    "default"
  );

  return { rootSemitone, scale, tempo, progression, rand, style };
}

function scaleFreq(params: MusicParams, degree: number, octave: number): number {
  const octaveOffset = Math.floor(degree / params.scale.length);
  const idx = ((degree % params.scale.length) + params.scale.length) % params.scale.length;
  return noteFreq(params.rootSemitone + params.scale[idx], octave + octaveOffset);
}

function chordRootDegree(params: MusicParams, progressionStep: number): number {
  return params.progression[progressionStep % params.progression.length];
}

// ---------------------------------------------------------------------------
// Music generation — layered synthesis
// ---------------------------------------------------------------------------

function generateMusicSamples(prompt: string, durationSeconds: number, options?: SoundGenOptions): Float32Array {
  const params = parseMusicParams(prompt, options);
  const { tempo, rand, style } = params;
  const numSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(numSamples);

  const beatDuration = 60 / tempo;
  const barDuration = beatDuration * 4;

  const volumes = style === "chiptune"
    ? { bass: 0.25, chord: 0.15, melody: 0.3, rhythm: 0.2 }
    : style === "lo-fi"
    ? { bass: 0.3, chord: 0.25, melody: 0.15, rhythm: 0.1 }
    : style === "electronic"
    ? { bass: 0.35, chord: 0.2, melody: 0.25, rhythm: 0.2 }
    : { bass: 0.25, chord: 0.2, melody: 0.25, rhythm: 0.15 };

  const melodyPattern: number[] = [];
  for (let i = 0; i < 32; i++) {
    melodyPattern.push(Math.floor(rand() * 7));
  }

  const arpPattern = [0, 2, 4, 7, 4, 2];

  let bassPhase = 0;
  const chordPhases = [0, 0, 0];
  let melodyPhase = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;

    const barIndex = Math.floor(t / barDuration);
    const beatInBar = (t % barDuration) / beatDuration;
    const currentBeat = Math.floor(beatInBar);
    const progressionStep = barIndex % params.progression.length;
    const rootDeg = chordRootDegree(params, progressionStep);

    // Bass line — plays on beats 0 and 2
    const bassFreq = scaleFreq(params, rootDeg, -2);
    bassPhase += bassFreq / SAMPLE_RATE;
    const bassTrigger = (currentBeat === 0 || currentBeat === 2) ? beatInBar % 2 : (beatInBar - 1) % 2;
    const bassEnv = Math.max(0, 1 - bassTrigger * 0.8);
    const bassWave = style === "chiptune" ? triangle(bassPhase) : sine(bassPhase);
    const bass = bassWave * bassEnv * volumes.bass;

    // Chord pad — triad
    const chordDegs = [rootDeg, rootDeg + 2, rootDeg + 4];
    let chord = 0;
    for (let c = 0; c < 3; c++) {
      const freq = scaleFreq(params, chordDegs[c], -1);
      chordPhases[c] += freq / SAMPLE_RATE;
      const wave = style === "chiptune" ? square(chordPhases[c], 0.25) :
                   style === "electronic" ? sawtooth(chordPhases[c]) :
                   triangle(chordPhases[c]);
      chord += wave;
    }
    const chordAttack = Math.min(1, (t % barDuration) / (beatDuration * 0.5));
    chord = (chord / 3) * chordAttack * volumes.chord;

    // Melody / arpeggio
    let melody = 0;
    if (style === "lo-fi" || style === "ambient") {
      const arpIndex = Math.floor((t / beatDuration) * 2) % arpPattern.length;
      const melDeg = rootDeg + arpPattern[arpIndex];
      const melFreq = scaleFreq(params, melDeg, 0);
      melodyPhase += melFreq / SAMPLE_RATE;
      const subBeat = (t / (beatDuration / 2)) % 1;
      const melEnv = Math.max(0, 1 - subBeat * 0.6);
      melody = sine(melodyPhase) * melEnv * volumes.melody;
    } else {
      const noteIndex = (Math.floor((t / beatDuration) * 2) + barIndex * 8) % melodyPattern.length;
      const melDeg = melodyPattern[noteIndex];
      const melFreq = scaleFreq(params, melDeg, 0);
      melodyPhase += melFreq / SAMPLE_RATE;
      const subBeat = (t / (beatDuration / 2)) % 1;
      const melEnv = Math.max(0, 1 - subBeat * 0.5);
      const melWave = style === "chiptune" ? square(melodyPhase) : sine(melodyPhase);
      melody = melWave * melEnv * volumes.melody;
    }

    // Rhythm
    let rhythm = 0;
    const sixteenth = (t / (beatDuration / 4)) % 1;
    const sixteenthIndex = Math.floor(t / (beatDuration / 4)) % 16;

    if (sixteenthIndex % 2 === 0) {
      const hatEnv = Math.max(0, 1 - sixteenth * 8);
      rhythm += (rand() * 2 - 1) * hatEnv * 0.5;
    }
    if (sixteenthIndex === 0 || sixteenthIndex === 8) {
      const kickEnv = Math.max(0, 1 - sixteenth * 4);
      const kickFreq = 60 * Math.max(1, 3 - sixteenth * 8);
      rhythm += sine(kickFreq * t) * kickEnv * 0.8;
    }
    if (sixteenthIndex === 4 || sixteenthIndex === 12) {
      const snareEnv = Math.max(0, 1 - sixteenth * 6);
      rhythm += (rand() * 2 - 1) * snareEnv * 0.6;
    }
    rhythm *= volumes.rhythm;

    // Mix with global envelope
    let sample = bass + chord + melody + rhythm;
    const fadeIn = Math.min(1, t / 0.5);
    const fadeOut = Math.min(1, (durationSeconds - t) / 1.0);
    sample *= fadeIn * fadeOut;

    samples[i] = Math.tanh(sample * 0.8);
  }

  return samples;
}

// ---------------------------------------------------------------------------
// Ambient generation — layered drones + textures
// ---------------------------------------------------------------------------

function generateAmbientSamples(prompt: string, durationSeconds: number): Float32Array {
  const rand = createPRNG(prompt);
  const numSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(numSamples);

  const baseFreq = 80 + rand() * 60;
  const drone2 = baseFreq * (1.5 + rand() * 0.02);
  const drone3 = baseFreq * (2.0 + rand() * 0.01);

  const sparkleFreqs: number[] = [];
  for (let i = 0; i < 5; i++) sparkleFreqs.push(800 + rand() * 2000);

  const sparkleTimes: number[] = [];
  for (let i = 0; i < Math.floor(durationSeconds * 2); i++) {
    sparkleTimes.push(rand() * durationSeconds);
  }
  sparkleTimes.sort((a, b) => a - b);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;

    // Low drone layer with slow LFO modulation
    const lfo1 = 1 + 0.003 * sine(t * 0.1);
    const lfo2 = 1 + 0.002 * sine(t * 0.07);
    sample += sine(baseFreq * lfo1 * t) * 0.2;
    sample += sine(drone2 * lfo2 * t) * 0.12;
    sample += sine(drone3 * t) * 0.08;

    // Filtered noise texture
    const noise = rand() * 2 - 1;
    const noiseMod = (1 + sine(t * 0.3)) * 0.5;
    sample += noise * noiseMod * 0.06;

    // Sparkle tones
    for (let s = 0; s < sparkleTimes.length; s++) {
      const dt = t - sparkleTimes[s];
      if (dt >= 0 && dt < 2.0) {
        const sFreq = sparkleFreqs[s % sparkleFreqs.length];
        const env = Math.exp(-dt * 3) * 0.15;
        sample += sine(sFreq * t) * env;
      }
    }

    // Global envelope
    const fadeIn = Math.min(1, t / 2.0);
    const fadeOut = Math.min(1, (durationSeconds - t) / 2.0);
    sample *= fadeIn * fadeOut;

    samples[i] = Math.tanh(sample);
  }

  return samples;
}

// ---------------------------------------------------------------------------
// SFX generation (original logic, preserved)
// ---------------------------------------------------------------------------

function detectSoundType(prompt: string): "tone" | "noise" | "sweep" | "beep" | "explosion" {
  const lower = prompt.toLowerCase();
  if (lower.includes("explo") || lower.includes("boom") || lower.includes("crash")) return "explosion";
  if (lower.includes("beep") || lower.includes("click") || lower.includes("coin") || lower.includes("pickup")) return "beep";
  if (lower.includes("sweep") || lower.includes("laser") || lower.includes("whoosh")) return "sweep";
  if (lower.includes("noise") || lower.includes("wind") || lower.includes("rain") || lower.includes("static")) return "noise";
  return "tone";
}

function generateSfxSamples(prompt: string, durationSeconds: number): Float32Array {
  const numSamples = Math.floor(SAMPLE_RATE * durationSeconds);
  const samples = new Float32Array(numSamples);
  const type = detectSoundType(prompt);
  const rand = createPRNG(prompt);

  let seed = 0;
  for (let i = 0; i < prompt.length; i++) seed = ((seed << 5) - seed + prompt.charCodeAt(i)) | 0;
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
        const rumble = Math.sin(2 * Math.PI * 60 * t) * 0.5;
        const noise = (rand() * 2 - 1) * 0.5;
        samples[i] = (rumble + noise) * envelope * 0.7;
      }
      break;
    }
  }

  return samples;
}

// ---------------------------------------------------------------------------
// WAV encoder
// ---------------------------------------------------------------------------

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
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);

  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class ProceduralSoundProvider implements SoundGenProvider {
  type = "procedural" as const;

  async generate(prompt: string, options?: SoundGenOptions): Promise<SoundGenResult> {
    const category = options?.category ?? "sfx";
    let samples: Float32Array;

    switch (category) {
      case "music":
        samples = generateMusicSamples(prompt, options?.durationSeconds ?? 5, options);
        break;
      case "ambient":
        samples = generateAmbientSamples(prompt, options?.durationSeconds ?? 10);
        break;
      case "sfx":
      default:
        samples = generateSfxSamples(prompt, options?.durationSeconds ?? 1);
        break;
    }

    const data = encodeWAV(samples);
    return { data, format: "wav", provider: "procedural" };
  }
}
