/**
 * TTS provider abstraction — Kokoro (local) and OpenAI-compatible (cloud).
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../auth/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Persistent model cache directory (bind-mounted volume in Docker) */
function getModelCacheDir(): string {
  const dataDir =
    process.env.WORKSPACE_ROOT ??
    resolve(__dirname, "../../../../docker/otterbot");
  return resolve(dataDir, "data", "models");
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TTSProvider {
  synthesize(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ audio: Buffer; contentType: string }>;
}

// ---------------------------------------------------------------------------
// Kokoro provider (local, kokoro-js)
// ---------------------------------------------------------------------------

let kokoroInstance: any = null;

class KokoroProvider implements TTSProvider {
  async synthesize(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ audio: Buffer; contentType: string }> {
    if (!kokoroInstance) {
      // Point HuggingFace cache to persistent volume so model survives restarts
      const cacheDir = getModelCacheDir();
      process.env.HF_HOME = cacheDir;
      process.env.TRANSFORMERS_CACHE = cacheDir;

      const { KokoroTTS } = await import("kokoro-js");
      kokoroInstance = await KokoroTTS.from_pretrained(
        "onnx-community/Kokoro-82M-v1.0-ONNX",
        { dtype: "q8", device: "cpu" },
      );
    }

    const audio = await kokoroInstance.generate(text, { voice, speed });
    const wav = audio.toWav();
    return {
      audio: Buffer.from(wav),
      contentType: "audio/wav",
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (HTTP)
// ---------------------------------------------------------------------------

class OpenAICompatibleProvider implements TTSProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async synthesize(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ audio: Buffer; contentType: string }> {
    const url = `${this.baseUrl}/v1/audio/speech`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice,
        speed,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TTS API error ${res.status}: ${body}`);
    }

    const contentType =
      res.headers.get("content-type") ?? "audio/mpeg";
    const arrayBuffer = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      contentType,
    };
  }
}

// ---------------------------------------------------------------------------
// Edge TTS provider (Microsoft neural TTS, free cloud service)
// ---------------------------------------------------------------------------

class EdgeTTSProvider implements TTSProvider {
  async synthesize(
    text: string,
    voice: string,
    speed: number,
  ): Promise<{ audio: Buffer; contentType: string }> {
    const { EdgeTTS } = await import("@andresaya/edge-tts");
    const tts = new EdgeTTS();

    // Convert speed multiplier (0.5–2.0) to Edge TTS rate string (e.g. 1.5 → "+50%")
    const ratePercent = Math.round((speed - 1) * 100);
    const rate = ratePercent >= 0 ? `+${ratePercent}%` : `${ratePercent}%`;

    await tts.synthesize(text, voice, { rate });
    const buffer = await tts.toBuffer();

    return {
      audio: Buffer.from(buffer),
      contentType: "audio/mpeg",
    };
  }
}

// ---------------------------------------------------------------------------
// Markdown stripping — remove formatting so TTS reads clean prose
// ---------------------------------------------------------------------------

export function stripMarkdown(text: string): string {
  return (
    text
      // Fenced code/diagram blocks (```mermaid, ~~~mermaid, etc.)
      .replace(/(`{3,}|~{3,})[a-z]*\n[\s\S]*?\1/g, "")
      // Inline code (`...`)
      .replace(/`([^`]+)`/g, "$1")
      // Images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      // Links [text](url)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Headings (# ... ######)
      .replace(/^#{1,6}\s+/gm, "")
      // Bold/italic (*** ** * ___ __ _)
      .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")
      // Strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, "$1")
      // Horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // List items: strip marker and append comma so TTS pauses between items
      .replace(/^\s*[-*+]\s+(.+)$/gm, "$1,")
      .replace(/^\s*\d+\.\s+(.+)$/gm, "$1,")
      // Blockquotes
      .replace(/^\s*>\s?/gm, "")
      // HTML tags
      .replace(/<[^>]+>/g, "")
      // Emojis
      .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, "")
      // Collapse multiple blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ---------------------------------------------------------------------------
// Deepgram TTS provider (cloud)
// ---------------------------------------------------------------------------

class DeepgramTTSProvider implements TTSProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async synthesize(
    text: string,
    voice: string,
    _speed: number,
  ): Promise<{ audio: Buffer; contentType: string }> {
    const model = voice || "aura-asteria-en";
    const params = new URLSearchParams({ model });

    const url = `https://api.deepgram.com/v1/speak?${params.toString()}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Deepgram TTS error ${res.status}: ${body}`);
    }

    const contentType = res.headers.get("content-type") ?? "audio/mpeg";
    const arrayBuffer = await res.arrayBuffer();
    return {
      audio: Buffer.from(arrayBuffer),
      contentType,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getConfiguredTTSProvider(): TTSProvider | null {
  const activeProvider = getConfig("tts:active_provider");
  if (!activeProvider) return null;

  switch (activeProvider) {
    case "kokoro":
      return new KokoroProvider();

    case "edge-tts":
      return new EdgeTTSProvider();

    case "openai-compatible": {
      const baseUrl = getConfig("tts:openai-compatible:base_url");
      const apiKey = getConfig("tts:openai-compatible:api_key") ?? "";
      if (!baseUrl) return null;
      return new OpenAICompatibleProvider(baseUrl, apiKey);
    }

    case "deepgram": {
      const apiKey = getConfig("tts:deepgram:api_key");
      if (!apiKey) return null;
      return new DeepgramTTSProvider(apiKey);
    }

    default:
      return null;
  }
}

export function isTTSEnabled(): boolean {
  return (
    getConfig("tts:enabled") === "true" &&
    getConfiguredTTSProvider() !== null
  );
}
