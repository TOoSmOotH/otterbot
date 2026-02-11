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
