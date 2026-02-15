/**
 * Settings module — typed wrappers around the config key-value store
 * for provider management, tier defaults, and model discovery.
 */

import {
  getConfig,
  setConfig,
  deleteConfig,
} from "../auth/auth.js";
import { resolveModel, type LLMConfig } from "../llm/adapter.js";
import { generateText } from "ai";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { getConfiguredTTSProvider } from "../tts/tts.js";
import { getConfiguredSTTProvider } from "../stt/stt.js";
import { OpenCodeClient } from "../tools/opencode-client.js";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NamedProvider, ProviderType, ProviderTypeMeta, CustomModel, ModelOption } from "@otterbot/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierDefaults {
  coo: { provider: string; model: string };
  teamLead: { provider: string; model: string };
  worker: { provider: string; model: string };
}

export interface SettingsResponse {
  providers: NamedProvider[];
  providerTypes: ProviderTypeMeta[];
  defaults: TierDefaults;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Provider type metadata (static)
// ---------------------------------------------------------------------------

export const PROVIDER_TYPE_META: ProviderTypeMeta[] = [
  { type: "anthropic", label: "Anthropic", needsApiKey: true, needsBaseUrl: false },
  { type: "openai", label: "OpenAI", needsApiKey: true, needsBaseUrl: false },
  { type: "ollama", label: "Ollama", needsApiKey: false, needsBaseUrl: true },
  { type: "openai-compatible", label: "OpenAI-Compatible", needsApiKey: true, needsBaseUrl: true },
];

// Static fallback models per provider (used when API fetch fails)
const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-20250414",
    "claude-opus-4-20250514",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  ollama: ["llama3.1", "mistral", "codellama", "qwen2.5-coder"],
  "openai-compatible": [],
};

// ---------------------------------------------------------------------------
// Search provider metadata
// ---------------------------------------------------------------------------

export interface SearchProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;   // masked
  apiKeySet: boolean;
  baseUrl?: string;
}

export interface SearchSettingsResponse {
  activeProvider: string | null;
  providers: SearchProviderConfig[];
}

const SEARCH_PROVIDER_META: Record<
  string,
  { name: string; needsApiKey: boolean; needsBaseUrl: boolean }
> = {
  duckduckgo: { name: "DuckDuckGo", needsApiKey: false, needsBaseUrl: false },
  searxng: { name: "SearXNG", needsApiKey: false, needsBaseUrl: true },
  brave:   { name: "Brave Search", needsApiKey: true, needsBaseUrl: false },
  tavily:  { name: "Tavily", needsApiKey: true, needsBaseUrl: false },
};

// ---------------------------------------------------------------------------
// API key masking
// ---------------------------------------------------------------------------

function maskApiKey(key: string | undefined): string | undefined {
  if (!key || key.length < 4) return undefined;
  return `...${key.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Provider CRUD
// ---------------------------------------------------------------------------

export function listProviders(): NamedProvider[] {
  const db = getDb();
  const rows = db.select().from(schema.providers).all();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as ProviderType,
    apiKeySet: !!row.apiKey,
    apiKeyMasked: maskApiKey(row.apiKey ?? undefined),
    baseUrl: row.baseUrl ?? undefined,
    createdAt: row.createdAt,
  }));
}

export function getProviderRow(id: string) {
  const db = getDb();
  return db.select().from(schema.providers).where(eq(schema.providers.id, id)).get();
}

export function createProvider(data: {
  name: string;
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
}): NamedProvider {
  const db = getDb();
  const id = nanoid();
  const now = new Date().toISOString();
  db.insert(schema.providers)
    .values({
      id,
      name: data.name,
      type: data.type,
      apiKey: data.apiKey ?? null,
      baseUrl: data.baseUrl ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    id,
    name: data.name,
    type: data.type,
    apiKeySet: !!data.apiKey,
    apiKeyMasked: maskApiKey(data.apiKey),
    baseUrl: data.baseUrl,
    createdAt: now,
  };
}

export function updateProvider(
  id: string,
  data: { name?: string; apiKey?: string; baseUrl?: string },
): void {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.apiKey !== undefined) updates.apiKey = data.apiKey || null;
  if (data.baseUrl !== undefined) updates.baseUrl = data.baseUrl || null;
  db.update(schema.providers).set(updates).where(eq(schema.providers.id, id)).run();
}

export function deleteProvider(id: string): { ok: boolean; error?: string } {
  // Check if provider is referenced by tier defaults
  for (const key of ["coo_provider", "team_lead_provider", "worker_provider"]) {
    if (getConfig(key) === id) {
      return { ok: false, error: `Provider is in use as a tier default (${key.replace("_provider", "").replace("_", " ")})` };
    }
  }
  const db = getDb();
  db.delete(schema.providers).where(eq(schema.providers.id, id)).run();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read settings
// ---------------------------------------------------------------------------

export function getSettings(): SettingsResponse {
  const providers = listProviders();

  const cooProvider = getConfig("coo_provider") ?? "";
  const cooModel = getConfig("coo_model") ?? "claude-sonnet-4-5-20250929";

  const defaults: TierDefaults = {
    coo: {
      provider: cooProvider,
      model: cooModel,
    },
    teamLead: {
      provider: getConfig("team_lead_provider") ?? cooProvider,
      model: getConfig("team_lead_model") ?? cooModel,
    },
    worker: {
      provider: getConfig("worker_provider") ?? cooProvider,
      model: getConfig("worker_model") ?? cooModel,
    },
  };

  return { providers, providerTypes: PROVIDER_TYPE_META, defaults };
}

// ---------------------------------------------------------------------------
// Update tier defaults
// ---------------------------------------------------------------------------

export function updateTierDefaults(
  defaults: Partial<TierDefaults>,
): void {
  if (defaults.coo) {
    setConfig("coo_provider", defaults.coo.provider);
    setConfig("coo_model", defaults.coo.model);
  }
  if (defaults.teamLead) {
    setConfig("team_lead_provider", defaults.teamLead.provider);
    setConfig("team_lead_model", defaults.teamLead.model);
  }
  if (defaults.worker) {
    setConfig("worker_provider", defaults.worker.provider);
    setConfig("worker_model", defaults.worker.model);
  }
}

// ---------------------------------------------------------------------------
// Test provider connection
// ---------------------------------------------------------------------------

export async function testProvider(
  providerId: string,
  model?: string,
): Promise<TestResult> {
  const start = Date.now();

  // Look up provider row to determine type
  const row = getProviderRow(providerId);
  const providerType = row?.type ?? providerId;

  // Determine which model to test with
  const testModel =
    model ??
    FALLBACK_MODELS[providerType]?.[0] ??
    "test";

  const config: LLMConfig = {
    provider: providerId,
    model: testModel,
  };

  try {
    const resolved = resolveModel(config);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      await generateText({
        model: resolved,
        messages: [{ role: "user", content: "Respond with exactly: OK" }],
        maxTokens: 5,
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Fetch models from provider API
// ---------------------------------------------------------------------------

export async function fetchModelsWithCredentials(
  providerId: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<string[]> {
  try {
    switch (providerId) {
      case "anthropic": {
        if (!apiKey) return FALLBACK_MODELS.anthropic ?? [];
        const res = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return FALLBACK_MODELS.anthropic ?? [];
        const data = (await res.json()) as {
          data?: Array<{ id: string }>;
        };
        return data.data?.map((m) => m.id) ?? FALLBACK_MODELS.anthropic ?? [];
      }

      case "openai": {
        if (!apiKey) return FALLBACK_MODELS.openai ?? [];
        const effectiveBase = baseUrl ?? "https://api.openai.com";
        const res = await fetch(`${effectiveBase}/v1/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return FALLBACK_MODELS.openai ?? [];
        const data = (await res.json()) as {
          data?: Array<{ id: string }>;
        };
        return data.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS.openai ?? [];
      }

      case "ollama": {
        const effectiveBase = baseUrl ?? "http://localhost:11434/api";
        const tagsUrl = effectiveBase.endsWith("/api")
          ? `${effectiveBase}/tags`
          : `${effectiveBase}/api/tags`;
        const res = await fetch(tagsUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return FALLBACK_MODELS.ollama ?? [];
        const data = (await res.json()) as {
          models?: Array<{ name: string }>;
        };
        return (
          data.models?.map((m) => m.name) ?? FALLBACK_MODELS.ollama ?? []
        );
      }

      case "openai-compatible": {
        if (!baseUrl) return [];
        const headers: Record<string, string> = {};
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(`${baseUrl}/v1/models`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as {
          data?: Array<{ id: string }>;
        };
        return data.data?.map((m) => m.id).sort() ?? [];
      }

      default:
        return FALLBACK_MODELS[providerId] ?? [];
    }
  } catch {
    return FALLBACK_MODELS[providerId] ?? [];
  }
}

export async function fetchModels(providerId: string): Promise<ModelOption[]> {
  // Look up credentials from the providers table
  const row = getProviderRow(providerId);
  const discovered = row
    ? await fetchModelsWithCredentials(row.type, row.apiKey ?? undefined, row.baseUrl ?? undefined)
    : await fetchModelsWithCredentials(providerId);

  // Get custom models for this provider
  const custom = listCustomModels(providerId);

  // Build merged list: custom models first (they win on labels), then discovered
  const seen = new Set<string>();
  const result: ModelOption[] = [];

  for (const cm of custom) {
    seen.add(cm.modelId);
    result.push({ modelId: cm.modelId, label: cm.label, source: "custom" });
  }
  for (const modelId of discovered) {
    if (!seen.has(modelId)) {
      result.push({ modelId, source: "discovered" });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Custom models CRUD
// ---------------------------------------------------------------------------

export function listCustomModels(providerId?: string): CustomModel[] {
  const db = getDb();
  if (providerId) {
    return db
      .select()
      .from(schema.customModels)
      .where(eq(schema.customModels.providerId, providerId))
      .all()
      .map(toCustomModel);
  }
  return db.select().from(schema.customModels).all().map(toCustomModel);
}

export function createCustomModel(data: {
  providerId: string;
  modelId: string;
  label?: string;
}): CustomModel {
  const db = getDb();
  const id = nanoid();
  const now = new Date().toISOString();
  db.insert(schema.customModels)
    .values({
      id,
      providerId: data.providerId,
      modelId: data.modelId,
      label: data.label ?? null,
      createdAt: now,
    })
    .run();
  return { id, providerId: data.providerId, modelId: data.modelId, label: data.label, createdAt: now };
}

export function deleteCustomModel(id: string): void {
  const db = getDb();
  db.delete(schema.customModels).where(eq(schema.customModels.id, id)).run();
}

function toCustomModel(row: typeof schema.customModels.$inferSelect): CustomModel {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    label: row.label ?? undefined,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Search settings
// ---------------------------------------------------------------------------

export function getSearchSettings(): SearchSettingsResponse {
  const activeProvider = getConfig("search:active_provider") ?? null;

  const providers = Object.entries(SEARCH_PROVIDER_META).map(
    ([id, meta]) => {
      const rawKey = getConfig(`search:${id}:api_key`);
      const baseUrl = getConfig(`search:${id}:base_url`);

      return {
        id,
        name: meta.name,
        needsApiKey: meta.needsApiKey,
        needsBaseUrl: meta.needsBaseUrl,
        apiKey: maskApiKey(rawKey),
        apiKeySet: !!rawKey,
        baseUrl: baseUrl || undefined,
      } satisfies SearchProviderConfig;
    },
  );

  return { activeProvider, providers };
}

export function updateSearchProviderConfig(
  providerId: string,
  data: { apiKey?: string; baseUrl?: string },
): void {
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig(`search:${providerId}:api_key`);
    } else {
      setConfig(`search:${providerId}:api_key`, data.apiKey);
    }
  }
  if (data.baseUrl !== undefined) {
    if (data.baseUrl === "") {
      deleteConfig(`search:${providerId}:base_url`);
    } else {
      setConfig(`search:${providerId}:base_url`, data.baseUrl);
    }
  }
}

export function setActiveSearchProvider(providerId: string | null): void {
  if (!providerId) {
    deleteConfig("search:active_provider");
  } else {
    setConfig("search:active_provider", providerId);
  }
}

export async function testSearchProvider(
  providerId: string,
): Promise<TestResult> {
  const start = Date.now();

  // Temporarily set active provider so factory picks it up
  const previousActive = getConfig("search:active_provider");
  setConfig("search:active_provider", providerId);

  try {
    const provider = getConfiguredSearchProvider();
    if (!provider) {
      return {
        ok: false,
        error: `Provider "${providerId}" is not configured (missing credentials).`,
      };
    }

    const response = await provider.search("test", 1);
    // Any non-error response counts as success
    return {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    // Restore previous active provider
    if (previousActive) {
      setConfig("search:active_provider", previousActive);
    } else {
      deleteConfig("search:active_provider");
    }
  }
}

// ---------------------------------------------------------------------------
// TTS settings
// ---------------------------------------------------------------------------

export interface TTSProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;
  apiKeySet: boolean;
  baseUrl?: string;
  voices: string[];
}

export interface TTSSettingsResponse {
  enabled: boolean;
  activeProvider: string | null;
  voice: string;
  speed: number;
  providers: TTSProviderConfig[];
}

const TTS_PROVIDER_META: Record<
  string,
  { name: string; needsApiKey: boolean; needsBaseUrl: boolean }
> = {
  kokoro: { name: "Kokoro", needsApiKey: false, needsBaseUrl: false },
  "edge-tts": { name: "Edge TTS", needsApiKey: false, needsBaseUrl: false },
  "openai-compatible": {
    name: "OpenAI-compatible",
    needsApiKey: true,
    needsBaseUrl: true,
  },
};

const TTS_VOICES: Record<string, string[]> = {
  kokoro: [
    // American English
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica",
    "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
    "am_michael", "am_onyx", "am_puck", "am_santa",
    // British English
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
    // Japanese
    "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro",
    "jm_kumo",
    // Mandarin Chinese
    "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
    "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
    // Spanish
    "ef_dora", "em_alex", "em_santa",
    // French
    "ff_siwis",
    // Hindi
    "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
    // Italian
    "if_sara", "im_nicola",
    // Brazilian Portuguese
    "pf_dora", "pm_alex", "pm_santa",
  ],
  "edge-tts": [
    // English (US)
    "en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural",
    "en-US-DavisNeural", "en-US-SaraNeural",
    // English (GB)
    "en-GB-SoniaNeural", "en-GB-RyanNeural", "en-GB-LibbyNeural",
    // English (AU)
    "en-AU-NatashaNeural", "en-AU-WilliamNeural",
    // German
    "de-DE-KatjaNeural", "de-DE-ConradNeural",
    // French
    "fr-FR-DeniseNeural", "fr-FR-HenriNeural",
    // Spanish
    "es-ES-ElviraNeural", "es-ES-AlvaroNeural",
    // Italian
    "it-IT-ElsaNeural", "it-IT-DiegoNeural",
    // Portuguese (BR)
    "pt-BR-FranciscaNeural", "pt-BR-AntonioNeural",
    // Japanese
    "ja-JP-NanamiNeural", "ja-JP-KeitaNeural",
    // Chinese (Mandarin)
    "zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural",
    // Korean
    "ko-KR-SunHiNeural", "ko-KR-InJoonNeural",
    // Hindi
    "hi-IN-SwaraNeural", "hi-IN-MadhurNeural",
  ],
  "openai-compatible": [
    "alloy",
    "echo",
    "fable",
    "onyx",
    "nova",
    "shimmer",
  ],
};

export function getTTSSettings(): TTSSettingsResponse {
  const enabled = getConfig("tts:enabled") === "true";
  const activeProvider = getConfig("tts:active_provider") ?? null;
  const voice = getConfig("tts:voice") ?? "af_heart";
  const speed = parseFloat(getConfig("tts:speed") ?? "1");

  const providers = Object.entries(TTS_PROVIDER_META).map(([id, meta]) => {
    const rawKey = getConfig(`tts:${id}:api_key`);
    const baseUrl = getConfig(`tts:${id}:base_url`);

    return {
      id,
      name: meta.name,
      needsApiKey: meta.needsApiKey,
      needsBaseUrl: meta.needsBaseUrl,
      apiKey: maskApiKey(rawKey),
      apiKeySet: !!rawKey,
      baseUrl: baseUrl || undefined,
      voices: TTS_VOICES[id] ?? [],
    } satisfies TTSProviderConfig;
  });

  return { enabled, activeProvider, voice, speed, providers };
}

export function updateTTSProviderConfig(
  providerId: string,
  data: { apiKey?: string; baseUrl?: string },
): void {
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig(`tts:${providerId}:api_key`);
    } else {
      setConfig(`tts:${providerId}:api_key`, data.apiKey);
    }
  }
  if (data.baseUrl !== undefined) {
    if (data.baseUrl === "") {
      deleteConfig(`tts:${providerId}:base_url`);
    } else {
      setConfig(`tts:${providerId}:base_url`, data.baseUrl);
    }
  }
}

export function setActiveTTSProvider(providerId: string | null): void {
  if (!providerId) {
    deleteConfig("tts:active_provider");
  } else {
    setConfig("tts:active_provider", providerId);
  }
}

export function setTTSEnabled(enabled: boolean): void {
  setConfig("tts:enabled", enabled ? "true" : "false");
}

export function setTTSVoice(voice: string): void {
  setConfig("tts:voice", voice);
}

export function setTTSSpeed(speed: number): void {
  setConfig("tts:speed", String(speed));
}

export async function testTTSProvider(
  providerId: string,
): Promise<TestResult> {
  const start = Date.now();

  // Temporarily set active provider so factory picks it up
  const previousActive = getConfig("tts:active_provider");
  setConfig("tts:active_provider", providerId);

  try {
    const provider = getConfiguredTTSProvider();
    if (!provider) {
      return {
        ok: false,
        error: `Provider "${providerId}" is not configured.`,
      };
    }

    const voice = getConfig("tts:voice") ?? "af_heart";
    const speed = parseFloat(getConfig("tts:speed") ?? "1");
    await provider.synthesize("Hello, this is a test.", voice, speed);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    if (previousActive) {
      setConfig("tts:active_provider", previousActive);
    } else {
      deleteConfig("tts:active_provider");
    }
  }
}

// ---------------------------------------------------------------------------
// STT settings
// ---------------------------------------------------------------------------

export interface STTProviderConfig {
  id: string;
  name: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  apiKey?: string;
  apiKeySet: boolean;
  baseUrl?: string;
}

export interface STTSettingsResponse {
  enabled: boolean;
  activeProvider: string | null;
  language: string;
  modelId: string;
  providers: STTProviderConfig[];
}

const STT_PROVIDER_META: Record<
  string,
  { name: string; needsApiKey: boolean; needsBaseUrl: boolean }
> = {
  "whisper-local": {
    name: "Whisper (Local)",
    needsApiKey: false,
    needsBaseUrl: false,
  },
  "openai-compatible": {
    name: "OpenAI-compatible",
    needsApiKey: true,
    needsBaseUrl: true,
  },
  browser: {
    name: "Browser (Chrome/Edge)",
    needsApiKey: false,
    needsBaseUrl: false,
  },
};

export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny.en", label: "tiny.en (~75MB, English only)" },
  { id: "onnx-community/whisper-base", label: "base (~150MB, multilingual)" },
  { id: "onnx-community/whisper-base.en", label: "base.en (~150MB, English only)" },
  { id: "onnx-community/whisper-small", label: "small (~500MB, multilingual)" },
  { id: "onnx-community/whisper-small.en", label: "small.en (~500MB, English only)" },
];

export function getSTTSettings(): STTSettingsResponse {
  const enabled = getConfig("stt:enabled") === "true";
  const activeProvider = getConfig("stt:active_provider") ?? null;
  const language = getConfig("stt:language") ?? "";
  const modelId =
    getConfig("stt:whisper:model_id") ?? "onnx-community/whisper-base";

  const providers = Object.entries(STT_PROVIDER_META).map(([id, meta]) => {
    const rawKey = getConfig(`stt:${id}:api_key`);
    const baseUrl = getConfig(`stt:${id}:base_url`);

    return {
      id,
      name: meta.name,
      needsApiKey: meta.needsApiKey,
      needsBaseUrl: meta.needsBaseUrl,
      apiKey: maskApiKey(rawKey),
      apiKeySet: !!rawKey,
      baseUrl: baseUrl || undefined,
    } satisfies STTProviderConfig;
  });

  return { enabled, activeProvider, language, modelId, providers };
}

export function setSTTEnabled(enabled: boolean): void {
  setConfig("stt:enabled", enabled ? "true" : "false");
}

export function setActiveSTTProvider(providerId: string | null): void {
  if (!providerId) {
    deleteConfig("stt:active_provider");
  } else {
    setConfig("stt:active_provider", providerId);
  }
}

export function setSTTLanguage(language: string): void {
  if (!language) {
    deleteConfig("stt:language");
  } else {
    setConfig("stt:language", language);
  }
}

export function setSTTModel(modelId: string): void {
  setConfig("stt:whisper:model_id", modelId);
}

export function updateSTTProviderConfig(
  providerId: string,
  data: { apiKey?: string; baseUrl?: string },
): void {
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig(`stt:${providerId}:api_key`);
    } else {
      setConfig(`stt:${providerId}:api_key`, data.apiKey);
    }
  }
  if (data.baseUrl !== undefined) {
    if (data.baseUrl === "") {
      deleteConfig(`stt:${providerId}:base_url`);
    } else {
      setConfig(`stt:${providerId}:base_url`, data.baseUrl);
    }
  }
}

export async function testSTTProvider(
  providerId: string,
): Promise<TestResult> {
  const start = Date.now();

  const previousActive = getConfig("stt:active_provider");
  setConfig("stt:active_provider", providerId);

  try {
    const provider = getConfiguredSTTProvider();
    if (!provider) {
      return {
        ok: false,
        error: `Provider "${providerId}" is not configured.`,
      };
    }

    // Generate a short silent audio buffer for testing
    // 16kHz, 1 second of silence as WAV
    const sampleRate = 16000;
    const numSamples = sampleRate; // 1 second
    const headerSize = 44;
    const dataSize = numSamples * 2; // 16-bit PCM
    const wav = Buffer.alloc(headerSize + dataSize);

    // WAV header
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16); // chunk size
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28); // byte rate
    wav.writeUInt16LE(2, 32); // block align
    wav.writeUInt16LE(16, 34); // bits per sample
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    // samples are all zeros (silence)

    await provider.transcribe(wav);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    if (previousActive) {
      setConfig("stt:active_provider", previousActive);
    } else {
      deleteConfig("stt:active_provider");
    }
  }
}

// ---------------------------------------------------------------------------
// OpenCode settings
// ---------------------------------------------------------------------------

export interface OpenCodeSettingsResponse {
  enabled: boolean;
  apiUrl: string;
  username: string;
  passwordSet: boolean;
  timeoutMs: number;
  maxIterations: number;
}

export function getOpenCodeSettings(): OpenCodeSettingsResponse {
  return {
    enabled: getConfig("opencode:enabled") === "true",
    apiUrl: getConfig("opencode:api_url") ?? "",
    username: getConfig("opencode:username") ?? "",
    passwordSet: !!getConfig("opencode:password"),
    timeoutMs: parseInt(getConfig("opencode:timeout_ms") ?? "180000", 10),
    maxIterations: parseInt(getConfig("opencode:max_iterations") ?? "50", 10),
  };
}

export function updateOpenCodeSettings(data: {
  enabled?: boolean;
  apiUrl?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  maxIterations?: number;
}): void {
  if (data.enabled !== undefined) {
    setConfig("opencode:enabled", data.enabled ? "true" : "false");
  }
  if (data.apiUrl !== undefined) {
    if (data.apiUrl === "") {
      deleteConfig("opencode:api_url");
    } else {
      setConfig("opencode:api_url", data.apiUrl);
    }
  }
  if (data.username !== undefined) {
    if (data.username === "") {
      deleteConfig("opencode:username");
    } else {
      setConfig("opencode:username", data.username);
    }
  }
  if (data.password !== undefined) {
    if (data.password === "") {
      deleteConfig("opencode:password");
    } else {
      setConfig("opencode:password", data.password);
    }
  }
  if (data.timeoutMs !== undefined) {
    setConfig("opencode:timeout_ms", String(data.timeoutMs));
  }
  if (data.maxIterations !== undefined) {
    setConfig("opencode:max_iterations", String(data.maxIterations));
  }
}

export async function testOpenCodeConnection(): Promise<TestResult> {
  const apiUrl = getConfig("opencode:api_url");
  if (!apiUrl) {
    return { ok: false, error: "API URL not configured." };
  }

  const start = Date.now();
  const client = new OpenCodeClient({
    apiUrl,
    username: getConfig("opencode:username") ?? undefined,
    password: getConfig("opencode:password") ?? undefined,
  });

  const result = await client.healthCheck();
  return {
    ok: result.ok,
    error: result.error,
    latencyMs: Date.now() - start,
  };
}
