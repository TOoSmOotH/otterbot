/**
 * Procedural image generation — no AI required.
 *
 * Generates simple colored textures, gradients, patterns, and checkerboards
 * using raw PNG encoding. Works as a zero-dependency fallback when no
 * AI image provider is configured.
 */

import type { ImageGenProvider, ImageGenOptions, ImageGenResult } from "./types.js";

// Minimal PNG encoder (no dependencies)
function createPNG(width: number, height: number, pixels: Uint8Array): Buffer {
  // Build uncompressed IDAT data (filter byte 0 + raw RGBA per row)
  const rawRows: number[] = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rawRows.push(pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]);
    }
  }

  // Deflate using zlib
  const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
  const compressed = deflateSync(Buffer.from(rawRows));

  // Build PNG file
  const chunks: Buffer[] = [];

  // Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(pngChunk("IHDR", ihdr));

  // IDAT
  chunks.push(pngChunk("IDAT", compressed));

  // IEND
  chunks.push(pngChunk("IEND", Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const { crc32 } = require("node:buffer") as { crc32: (data: Buffer | Uint8Array, seed?: number) => number };
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBytes, data]);

  let crcValue: number;
  if (typeof crc32 === "function") {
    crcValue = crc32(crcData) >>> 0;
  } else {
    // Fallback CRC-32 for older Node versions
    crcValue = crc32Fallback(crcData);
  }

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcValue, 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function crc32Fallback(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Color from a keyword in the prompt
function colorFromPrompt(prompt: string): [number, number, number] {
  const colors: Record<string, [number, number, number]> = {
    red: [220, 50, 47], blue: [38, 139, 210], green: [133, 153, 0],
    yellow: [181, 137, 0], orange: [203, 75, 22], purple: [108, 113, 196],
    pink: [211, 54, 130], cyan: [42, 161, 152], white: [238, 232, 213],
    black: [7, 54, 66], brown: [139, 90, 43], gray: [131, 148, 150],
    grey: [131, 148, 150], gold: [218, 165, 32], silver: [192, 192, 192],
    wood: [139, 90, 43], stone: [136, 140, 141], grass: [76, 153, 0],
    water: [38, 139, 210], sky: [108, 181, 234], lava: [207, 16, 32],
    sand: [237, 201, 141], dirt: [120, 84, 44], metal: [170, 170, 180],
    ice: [176, 224, 230],
  };
  const lower = prompt.toLowerCase();
  for (const [word, rgb] of Object.entries(colors)) {
    if (lower.includes(word)) return rgb;
  }
  // Deterministic hash color
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) - hash + prompt.charCodeAt(i)) | 0;
  }
  return [(hash & 0xff0000) >> 16, (hash & 0x00ff00) >> 8, hash & 0x0000ff];
}

// Detect what kind of pattern to generate
function detectPattern(prompt: string): "checker" | "gradient" | "noise" | "grid" | "solid" {
  const lower = prompt.toLowerCase();
  if (lower.includes("checker") || lower.includes("tile") || lower.includes("floor")) return "checker";
  if (lower.includes("gradient") || lower.includes("sky") || lower.includes("horizon")) return "gradient";
  if (lower.includes("noise") || lower.includes("rough") || lower.includes("stone") || lower.includes("dirt")) return "noise";
  if (lower.includes("grid") || lower.includes("metal") || lower.includes("panel")) return "grid";
  return "noise"; // default to noise for most textures
}

// Simple seeded PRNG
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ProceduralImageProvider implements ImageGenProvider {
  type = "procedural" as const;

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    const width = options?.width ?? 256;
    const height = options?.height ?? 256;
    const pixels = new Uint8Array(width * height * 4);

    const [r, g, b] = colorFromPrompt(prompt);
    const pattern = detectPattern(prompt);

    let seed = 0;
    for (let i = 0; i < prompt.length; i++) seed = ((seed << 5) - seed + prompt.charCodeAt(i)) | 0;
    const rand = mulberry32(seed);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let pr = r, pg = g, pb = b;

        switch (pattern) {
          case "checker": {
            const size = 32;
            const dark = ((Math.floor(x / size) + Math.floor(y / size)) % 2) === 0;
            const factor = dark ? 0.7 : 1.0;
            pr = Math.round(r * factor);
            pg = Math.round(g * factor);
            pb = Math.round(b * factor);
            break;
          }
          case "gradient": {
            const t = y / height;
            pr = Math.round(r * (1 - t) + r * 0.3 * t);
            pg = Math.round(g * (1 - t) + g * 0.3 * t);
            pb = Math.round(b * (1 - t) + 255 * t * 0.3);
            break;
          }
          case "noise": {
            const variation = (rand() - 0.5) * 60;
            pr = Math.max(0, Math.min(255, Math.round(r + variation)));
            pg = Math.max(0, Math.min(255, Math.round(g + variation)));
            pb = Math.max(0, Math.min(255, Math.round(b + variation)));
            break;
          }
          case "grid": {
            const gridSize = 16;
            const onLine = (x % gridSize === 0) || (y % gridSize === 0);
            const factor = onLine ? 0.6 : 1.0;
            pr = Math.round(r * factor);
            pg = Math.round(g * factor);
            pb = Math.round(b * factor);
            break;
          }
          case "solid":
          default: {
            pr = r;
            pg = g;
            pb = b;
            break;
          }
        }

        pixels[i] = pr;
        pixels[i + 1] = pg;
        pixels[i + 2] = pb;
        pixels[i + 3] = 255;
      }
    }

    const data = createPNG(width, height, pixels);
    return { data, mimeType: "image/png", provider: "procedural" };
  }
}
