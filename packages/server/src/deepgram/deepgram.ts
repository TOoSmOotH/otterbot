/**
 * Deepgram provider bridge — speech-to-text and text-to-speech via the
 * Deepgram REST API (https://developers.deepgram.com/docs).
 */

import { getConfig } from "../auth/auth.js";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeepgramConfig {
  apiKey: string;
  sttModel?: string;
  ttsModel?: string;
}

export interface TranscriptionResult {
  text: string;
  confidence: number;
  words?: Array<{ word: string; start: number; end: number; confidence: number }>;
}

export interface TTSResult {
  audio: Buffer;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Credential resolution
// ---------------------------------------------------------------------------

function resolveDeepgramCredentials(providerIdOrType?: string): DeepgramConfig | null {
  // Try named provider from DB first
  if (providerIdOrType) {
    try {
      const db = getDb();
      const row = db
        .select()
        .from(schema.providers)
        .where(eq(schema.providers.id, providerIdOrType))
        .get();
      if (row && row.type === "deepgram" && row.apiKey) {
        return { apiKey: row.apiKey };
      }
    } catch {
      // DB not ready — fall through
    }
  }

  // Legacy config-key fallback
  const apiKey = getConfig("provider:deepgram:api_key");
  if (apiKey) {
    return { apiKey };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Deepgram Bridge
// ---------------------------------------------------------------------------

export class DeepgramBridge {
  private apiKey: string;
  private sttModel: string;
  private ttsModel: string;

  constructor(config: DeepgramConfig) {
    this.apiKey = config.apiKey;
    this.sttModel = config.sttModel ?? "nova-3";
    this.ttsModel = config.ttsModel ?? "aura-asteria-en";
  }

  /**
   * Transcribe audio using Deepgram's speech-to-text API.
   *
   * @param audio   Raw audio buffer (WAV, MP3, OGG, FLAC, WebM, etc.)
   * @param opts    Optional overrides for model, language, and content type
   */
  async transcribeAudio(
    audio: Buffer,
    opts?: { model?: string; language?: string; contentType?: string },
  ): Promise<TranscriptionResult> {
    const model = opts?.model ?? this.sttModel;
    const params = new URLSearchParams({ model });
    if (opts?.language) {
      params.set("language", opts.language);
    }

    const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": opts?.contentType ?? "audio/wav",
      },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Deepgram STT error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{
            transcript: string;
            confidence: number;
            words?: Array<{
              word: string;
              start: number;
              end: number;
              confidence: number;
            }>;
          }>;
        }>;
      };
    };

    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    return {
      text: alt?.transcript?.trim() ?? "",
      confidence: alt?.confidence ?? 0,
      words: alt?.words,
    };
  }

  /**
   * Generate speech from text using Deepgram's text-to-speech API.
   *
   * @param text    Text to synthesize
   * @param opts    Optional overrides for model and encoding
   */
  async generateSpeech(
    text: string,
    opts?: { model?: string; encoding?: string },
  ): Promise<TTSResult> {
    const model = opts?.model ?? this.ttsModel;
    const params = new URLSearchParams({ model });
    if (opts?.encoding) {
      params.set("encoding", opts.encoding);
    }

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

/**
 * Create a DeepgramBridge from a named provider ID or fall back to legacy
 * config keys.  Returns null if no Deepgram credentials are configured.
 */
export function getDeepgramBridge(providerId?: string): DeepgramBridge | null {
  const creds = resolveDeepgramCredentials(providerId);
  if (!creds) return null;

  const sttModel = getConfig("deepgram:stt_model") ?? undefined;
  const ttsModel = getConfig("deepgram:tts_model") ?? undefined;

  return new DeepgramBridge({
    ...creds,
    sttModel,
    ttsModel,
  });
}
