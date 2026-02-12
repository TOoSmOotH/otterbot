/**
 * Settings module — typed wrappers around the config key-value store
 * for provider management, tier defaults, and model discovery.
 */

import {
  getConfig,
  setConfig,
  deleteConfig,
  getAvailableProviders,
} from "../auth/auth.js";
import { resolveModel, type LLMConfig } from "../llm/adapter.js";
import { generateText } from "ai";
import { getConfiguredSearchProvider } from "../tools/search/providers.js";
import { getConfiguredTTSProvider } from "../tts/tts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string; // masked: "...XXXX"
  apiKeySet: boolean;
  baseUrl?: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
}

export interface TierDefaults {
  coo: { provider: string; model: string };
  teamLead: { provider: string; model: string };
  worker: { provider: string; model: string };
}

export interface SettingsResponse {
  providers: ProviderConfig[];
  defaults: TierDefaults;
}

export interface TestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<
  string,
  { needsApiKey: boolean; needsBaseUrl: boolean }
> = {
  anthropic: { needsApiKey: true, needsBaseUrl: false },
  openai: { needsApiKey: true, needsBaseUrl: false },
  ollama: { needsApiKey: false, needsBaseUrl: true },
  "openai-compatible": { needsApiKey: true, needsBaseUrl: true },
};

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
// Read settings
// ---------------------------------------------------------------------------

export function getSettings(): SettingsResponse {
  const providers = getAvailableProviders().map((p) => {
    const meta = PROVIDER_META[p.id] ?? {
      needsApiKey: true,
      needsBaseUrl: false,
    };
    const rawKey = getConfig(`provider:${p.id}:api_key`);
    const baseUrl = getConfig(`provider:${p.id}:base_url`);

    return {
      id: p.id,
      name: p.name,
      apiKey: maskApiKey(rawKey),
      apiKeySet: !!rawKey,
      baseUrl: baseUrl || undefined,
      needsApiKey: meta.needsApiKey,
      needsBaseUrl: meta.needsBaseUrl,
    } satisfies ProviderConfig;
  });

  const cooProvider =
    getConfig("coo_provider") ?? "anthropic";
  const cooModel =
    getConfig("coo_model") ?? "claude-sonnet-4-5-20250929";

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

  return { providers, defaults };
}

// ---------------------------------------------------------------------------
// Update provider config
// ---------------------------------------------------------------------------

export function updateProviderConfig(
  providerId: string,
  data: { apiKey?: string; baseUrl?: string },
): void {
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig(`provider:${providerId}:api_key`);
    } else {
      setConfig(`provider:${providerId}:api_key`, data.apiKey);
    }
  }
  if (data.baseUrl !== undefined) {
    if (data.baseUrl === "") {
      deleteConfig(`provider:${providerId}:base_url`);
    } else {
      setConfig(`provider:${providerId}:base_url`, data.baseUrl);
    }
  }
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

  // Determine which model to test with
  const testModel =
    model ??
    FALLBACK_MODELS[providerId]?.[0] ??
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

export async function fetchModels(providerId: string): Promise<string[]> {
  try {
    switch (providerId) {
      case "anthropic": {
        const apiKey = getConfig("provider:anthropic:api_key");
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
        const apiKey = getConfig("provider:openai:api_key");
        if (!apiKey) return FALLBACK_MODELS.openai ?? [];
        const baseUrl =
          getConfig("provider:openai:base_url") ?? "https://api.openai.com";
        const res = await fetch(`${baseUrl}/v1/models`, {
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
        const baseUrl =
          getConfig("provider:ollama:base_url") ??
          "http://localhost:11434/api";
        // Ollama uses /api/tags to list models
        const tagsUrl = baseUrl.endsWith("/api")
          ? `${baseUrl}/tags`
          : `${baseUrl}/api/tags`;
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
        const baseUrl = getConfig("provider:openai-compatible:base_url");
        const apiKey = getConfig("provider:openai-compatible:api_key");
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
    // Network error, timeout, etc. — return fallback list
    return FALLBACK_MODELS[providerId] ?? [];
  }
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
