/**
 * STT provider abstraction — Whisper (local) and OpenAI-compatible (cloud).
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../auth/auth.js";
import { decodeToFloat32 } from "./audio-utils.js";

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

export interface STTProvider {
  transcribe(
    audio: Buffer,
    opts?: { language?: string },
  ): Promise<{ text: string }>;
}

// ---------------------------------------------------------------------------
// Whisper local provider (@huggingface/transformers)
// ---------------------------------------------------------------------------

let whisperPipeline: any = null;
let whisperModelId: string | null = null;

class WhisperLocalProvider implements STTProvider {
  private modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async transcribe(
    audio: Buffer,
    opts?: { language?: string },
  ): Promise<{ text: string }> {
    // Lazy-load (or reload if model changed)
    if (!whisperPipeline || whisperModelId !== this.modelId) {
      const cacheDir = getModelCacheDir();
      process.env.HF_HOME = cacheDir;
      process.env.TRANSFORMERS_CACHE = cacheDir;

      const { pipeline } = await import("@huggingface/transformers");
      whisperPipeline = await pipeline(
        "automatic-speech-recognition",
        this.modelId,
        { dtype: "q8", device: "cpu" },
      );
      whisperModelId = this.modelId;
    }

    // Decode audio to 16kHz mono float32
    const float32Audio = await decodeToFloat32(audio);

    const pipelineOpts: Record<string, any> = {};
    if (opts?.language) {
      pipelineOpts.language = opts.language;
    }

    const result = await whisperPipeline(float32Audio, pipelineOpts);
    return { text: (result as any).text?.trim() ?? "" };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (HTTP)
// ---------------------------------------------------------------------------

class OpenAICompatibleSTTProvider implements STTProvider {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async transcribe(
    audio: Buffer,
    opts?: { language?: string },
  ): Promise<{ text: string }> {
    const url = `${this.baseUrl}/v1/audio/transcriptions`;

    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audio)]), "audio.webm");
    formData.append("model", "whisper-1");
    if (opts?.language) {
      formData.append("language", opts.language);
    }

    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`STT API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { text: string };
    return { text: data.text?.trim() ?? "" };
  }
}

// ---------------------------------------------------------------------------
// Deepgram provider (cloud)
// ---------------------------------------------------------------------------

class DeepgramSTTProvider implements STTProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(
    audio: Buffer,
    opts?: { language?: string },
  ): Promise<{ text: string }> {
    const params = new URLSearchParams({ model: "nova-3" });
    if (opts?.language) {
      params.set("language", opts.language);
    }

    const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": "audio/wav",
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
          alternatives?: Array<{ transcript: string }>;
        }>;
      };
    };

    const transcript =
      data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    return { text: transcript.trim() };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function getConfiguredSTTProvider(): STTProvider | null {
  const activeProvider = getConfig("stt:active_provider");
  if (!activeProvider) return null;

  switch (activeProvider) {
    case "whisper-local": {
      const modelId =
        getConfig("stt:whisper:model_id") ?? "onnx-community/whisper-base";
      return new WhisperLocalProvider(modelId);
    }

    case "openai-compatible": {
      const baseUrl = getConfig("stt:openai-compatible:base_url");
      const apiKey = getConfig("stt:openai-compatible:api_key") ?? "";
      if (!baseUrl) return null;
      return new OpenAICompatibleSTTProvider(baseUrl, apiKey);
    }

    case "deepgram": {
      const apiKey = getConfig("stt:deepgram:api_key");
      if (!apiKey) return null;
      return new DeepgramSTTProvider(apiKey);
    }

    default:
      return null;
  }
}

export function isSTTEnabled(): boolean {
  return (
    getConfig("stt:enabled") === "true" &&
    getConfiguredSTTProvider() !== null
  );
}
