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
import { ensureOpenCodeConfig } from "../opencode/opencode-manager.js";
import { getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NamedProvider, ProviderType, ProviderTypeMeta, CustomModel, ModelOption, ClaudeCodeOAuthUsage, AgentModelOverride } from "@otterbot/shared";

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
  { type: "google", label: "Google Gemini", needsApiKey: true, needsBaseUrl: false },
  { type: "openrouter", label: "OpenRouter", needsApiKey: true, needsBaseUrl: false },
  { type: "ollama", label: "Ollama", needsApiKey: false, needsBaseUrl: true },
  { type: "openai-compatible", label: "OpenAI-Compatible", needsApiKey: true, needsBaseUrl: true },
  { type: "github-copilot", label: "GitHub Copilot", needsApiKey: true, needsBaseUrl: false },
  { type: "huggingface", label: "Hugging Face", needsApiKey: true, needsBaseUrl: false },
  { type: "nvidia", label: "NVIDIA", needsApiKey: true, needsBaseUrl: false },
  { type: "zai", label: "Z.AI", needsApiKey: true, needsBaseUrl: false },
  { type: "perplexity", label: "Perplexity Sonar", needsApiKey: true, needsBaseUrl: false },
  { type: "deepgram", label: "Deepgram", needsApiKey: true, needsBaseUrl: false },
  { type: "bedrock", label: "AWS Bedrock", needsApiKey: true, needsBaseUrl: true },
];

// Static fallback models per provider (used when API fetch fails)
const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-20250414",
    "claude-opus-4-20250514",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
  google: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ],
  ollama: ["llama3.1", "mistral", "codellama", "qwen2.5-coder"],
  openrouter: [
    "anthropic/claude-sonnet-4-5-20250929",
    "openai/gpt-4o",
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.3-70b-instruct",
  ],
  "openai-compatible": [],
  "github-copilot": ["gpt-4o", "gpt-4.1", "claude-sonnet-4-5-20250929", "o3-mini"],
  huggingface: [
    "meta-llama/Llama-3.1-8B-Instruct",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "microsoft/Phi-3-mini-4k-instruct",
    "Qwen/Qwen2.5-72B-Instruct",
  ],
  nvidia: [
    "meta/llama-3.1-70b-instruct",
    "meta/llama-3.1-8b-instruct",
    "mistralai/mistral-7b-instruct-v0.3",
    "mistralai/mixtral-8x22b-instruct-v0.1",
  ],
  zai: [
    "glm-5",
    "glm-4.7",
    "glm-4.6",
    "glm-4.6v",
    "glm-4.5-flash",
  ],
  perplexity: [
    "sonar",
    "sonar-pro",
    "sonar-reasoning",
    "sonar-reasoning-pro",
  ],
  deepgram: [],
  bedrock: [
    "anthropic.claude-sonnet-4-5-20250929-v1:0",
    "anthropic.claude-haiku-4-20250414-v1:0",
    "meta.llama3-1-70b-instruct-v1:0",
    "mistral.mistral-large-2407-v1:0",
    "amazon.titan-text-premier-v2:0",
  ],
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
// Per-agent model overrides
// ---------------------------------------------------------------------------

const AGENT_OVERRIDE_PREFIX = "agent_override:";

export function getAgentModelOverrides(): AgentModelOverride[] {
  const db = getDb();
  const rows = db.select().from(schema.config).all();
  const overrideMap = new Map<string, { provider?: string; model?: string }>();

  for (const row of rows) {
    if (!row.key.startsWith(AGENT_OVERRIDE_PREFIX)) continue;
    const rest = row.key.slice(AGENT_OVERRIDE_PREFIX.length);
    const lastColon = rest.lastIndexOf(":");
    if (lastColon === -1) continue;
    const registryEntryId = rest.slice(0, lastColon);
    const field = rest.slice(lastColon + 1);
    if (field !== "provider" && field !== "model") continue;
    const existing = overrideMap.get(registryEntryId) ?? {};
    existing[field] = row.value;
    overrideMap.set(registryEntryId, existing);
  }

  const result: AgentModelOverride[] = [];
  for (const [registryEntryId, fields] of overrideMap) {
    if (fields.provider && fields.model) {
      result.push({ registryEntryId, provider: fields.provider, model: fields.model });
    }
  }
  return result;
}

export function getAgentModelOverride(registryEntryId: string): AgentModelOverride | null {
  const provider = getConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:provider`);
  const model = getConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:model`);
  if (!provider || !model) return null;
  return { registryEntryId, provider, model };
}

export function setAgentModelOverride(registryEntryId: string, provider: string, model: string): void {
  setConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:provider`, provider);
  setConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:model`, model);
}

export function clearAgentModelOverride(registryEntryId: string): void {
  deleteConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:provider`);
  deleteConfig(`${AGENT_OVERRIDE_PREFIX}${registryEntryId}:model`);
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
// AWS Signature V4 helper for Bedrock model discovery
// ---------------------------------------------------------------------------

async function signAwsRequest(
  method: string,
  url: string,
  region: string,
  service: string,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<Record<string, string>> {
  const { createHmac, createHash } = await import("node:crypto");
  const parsedUrl = new URL(url);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = dateStamp + "T" + now.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const signedHeaders = "host;x-amz-date";
  const payloadHash = createHash("sha256").update("").digest("hex");

  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search.slice(1),
    `host:${parsedUrl.host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (key: Buffer | string, data: string) =>
    createHmac("sha256", key).update(data).digest();
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return {
    "x-amz-date": amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
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

      case "google": {
        if (!apiKey) return FALLBACK_MODELS.google ?? [];
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) return FALLBACK_MODELS.google ?? [];
        const data = (await res.json()) as {
          models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
        };
        return (
          data.models
            ?.filter((m) =>
              m.supportedGenerationMethods?.includes("generateContent"),
            )
            .map((m) => m.name.replace("models/", ""))
            .sort() ?? FALLBACK_MODELS.google ?? []
        );
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

      case "openrouter": {
        if (!apiKey) return FALLBACK_MODELS.openrouter ?? [];
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return FALLBACK_MODELS.openrouter ?? [];
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return data.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS.openrouter ?? [];
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

      case "github-copilot": {
        if (!apiKey) return FALLBACK_MODELS["github-copilot"] ?? [];
        const copilotBase = baseUrl ?? "https://api.githubcopilot.com";
        const res = await fetch(`${copilotBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return FALLBACK_MODELS["github-copilot"] ?? [];
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        return data.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS["github-copilot"] ?? [];
      }

      case "huggingface": {
        if (!apiKey) return FALLBACK_MODELS.huggingface ?? [];
        const hfRes = await fetch(
          "https://huggingface.co/api/models?pipeline_tag=text-generation&sort=likes&direction=-1&limit=50&filter=conversational",
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!hfRes.ok) return FALLBACK_MODELS.huggingface ?? [];
        const hfData = (await hfRes.json()) as Array<{ id: string }>;
        return Array.isArray(hfData)
          ? hfData.map((m) => m.id)
          : FALLBACK_MODELS.huggingface ?? [];
      }

      case "nvidia": {
        if (!apiKey) return FALLBACK_MODELS.nvidia ?? [];
        const nvidiaBase = baseUrl ?? "https://integrate.api.nvidia.com/v1";
        const nvidiaRes = await fetch(`${nvidiaBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!nvidiaRes.ok) return FALLBACK_MODELS.nvidia ?? [];
        const nvidiaData = (await nvidiaRes.json()) as { data?: Array<{ id: string }> };
        return nvidiaData.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS.nvidia ?? [];
      }

      case "zai": {
        if (!apiKey) return FALLBACK_MODELS.zai ?? [];
        const zaiBase = baseUrl ?? "https://api.z.ai/api/paas/v4";
        const zaiRes = await fetch(`${zaiBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!zaiRes.ok) return FALLBACK_MODELS.zai ?? [];
        const zaiData = (await zaiRes.json()) as { data?: Array<{ id: string }> };
        return zaiData.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS.zai ?? [];
      }

      case "bedrock": {
        // Bedrock stores credentials as "accessKeyId:secretAccessKey" in apiKey
        // and the region in baseUrl. Model discovery uses the Bedrock API.
        if (!apiKey) return FALLBACK_MODELS.bedrock ?? [];
        const [bedrockAccessKey, bedrockSecretKey] = apiKey.includes(":")
          ? apiKey.split(":", 2)
          : ["", ""];
        if (!bedrockAccessKey || !bedrockSecretKey) return FALLBACK_MODELS.bedrock ?? [];
        const bedrockRegion = baseUrl ?? "us-east-1";
        try {
          const bedrockRes = await fetch(
            `https://bedrock.${bedrockRegion}.amazonaws.com/foundation-models`,
            {
              headers: await signAwsRequest(
                "GET",
                `https://bedrock.${bedrockRegion}.amazonaws.com/foundation-models`,
                bedrockRegion,
                "bedrock",
                bedrockAccessKey,
                bedrockSecretKey,
              ),
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!bedrockRes.ok) return FALLBACK_MODELS.bedrock ?? [];
          const bedrockData = (await bedrockRes.json()) as {
            modelSummaries?: Array<{ modelId: string; inferenceTypesSupported?: string[] }>;
          };
          return (
            bedrockData.modelSummaries
              ?.filter((m) => m.inferenceTypesSupported?.includes("ON_DEMAND"))
              .map((m) => m.modelId)
              .sort() ?? FALLBACK_MODELS.bedrock ?? []
          );
        } catch {
          return FALLBACK_MODELS.bedrock ?? [];
        }
      }

      case "perplexity": {
        if (!apiKey) return FALLBACK_MODELS.perplexity ?? [];
        const pplxBase = baseUrl ?? "https://api.perplexity.ai";
        const pplxRes = await fetch(`${pplxBase}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!pplxRes.ok) return FALLBACK_MODELS.perplexity ?? [];
        const pplxData = (await pplxRes.json()) as { data?: Array<{ id: string }> };
        return pplxData.data?.map((m) => m.id).sort() ?? FALLBACK_MODELS.perplexity ?? [];
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
  deepgram: {
    name: "Deepgram",
    needsApiKey: true,
    needsBaseUrl: false,
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
  deepgram: [
    "aura-asteria-en",
    "aura-luna-en",
    "aura-stella-en",
    "aura-athena-en",
    "aura-hera-en",
    "aura-orion-en",
    "aura-arcas-en",
    "aura-perseus-en",
    "aura-angus-en",
    "aura-orpheus-en",
    "aura-helios-en",
    "aura-zeus-en",
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
  deepgram: {
    name: "Deepgram",
    needsApiKey: true,
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
  model: string;
  providerId: string;
  interactive: boolean;
}

export function getOpenCodeSettings(): OpenCodeSettingsResponse {
  return {
    enabled: getConfig("opencode:enabled") === "true",
    apiUrl: getConfig("opencode:api_url") ?? "",
    username: getConfig("opencode:username") ?? "",
    passwordSet: !!getConfig("opencode:password"),
    timeoutMs: parseInt(getConfig("opencode:timeout_ms") ?? "180000", 10),
    maxIterations: parseInt(getConfig("opencode:max_iterations") ?? "50", 10),
    model: getConfig("opencode:model") ?? "",
    providerId: getConfig("opencode:provider_id") ?? "",
    interactive: getConfig("opencode:interactive") === "true",
  };
}

export async function updateOpenCodeSettings(data: {
  enabled?: boolean;
  apiUrl?: string;
  username?: string;
  password?: string;
  timeoutMs?: number;
  maxIterations?: number;
  model?: string;
  providerId?: string;
  interactive?: boolean;
}): Promise<void> {
  const wasEnabled = getConfig("opencode:enabled") === "true";
  const oldModel = getConfig("opencode:model") ?? "";
  const oldProviderId = getConfig("opencode:provider_id") ?? "";
  const oldInteractive = getConfig("opencode:interactive") === "true";

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
  if (data.model !== undefined) {
    setConfig("opencode:model", data.model);
  }
  if (data.providerId !== undefined) {
    setConfig("opencode:provider_id", data.providerId);
    // Also store the provider type for config generation
    const row = getProviderRow(data.providerId);
    if (row) {
      setConfig("opencode:provider_type", row.type);
    }
  }
  if (data.interactive !== undefined) {
    if (data.interactive) {
      setConfig("opencode:interactive", "true");
    } else {
      deleteConfig("opencode:interactive");
    }
  }

  const isNowEnabled = getConfig("opencode:enabled") === "true";
  const newModel = getConfig("opencode:model") ?? "";
  const newProviderId = getConfig("opencode:provider_id") ?? "";
  const newInteractive = getConfig("opencode:interactive") === "true";
  const configChanged =
    newModel !== oldModel || newProviderId !== oldProviderId || newInteractive !== oldInteractive;

  // Rewrite OpenCode config file when settings change (PTY client reads it on spawn)
  if (isNowEnabled && configChanged) {
    ensureOpenCodeConfig();
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

// ---------------------------------------------------------------------------
// Claude Code settings
// ---------------------------------------------------------------------------

export interface ClaudeCodeSettingsResponse {
  enabled: boolean;
  authMode: "api-key" | "oauth";
  apiKeySet: boolean;
  model: string;
  approvalMode: "full-auto" | "auto-edit";
  timeoutMs: number;
  maxTurns: number;
}

export function getClaudeCodeSettings(): ClaudeCodeSettingsResponse {
  return {
    enabled: getConfig("claude-code:enabled") === "true",
    authMode: (getConfig("claude-code:auth_mode") ?? "api-key") as "api-key" | "oauth",
    apiKeySet: !!getConfig("claude-code:api_key"),
    model: getConfig("claude-code:model") ?? "claude-sonnet-4-5-20250929",
    approvalMode: (getConfig("claude-code:approval_mode") ?? "full-auto") as "full-auto" | "auto-edit",
    timeoutMs: parseInt(getConfig("claude-code:timeout_ms") ?? "1200000", 10),
    maxTurns: parseInt(getConfig("claude-code:max_turns") ?? "50", 10),
  };
}

export async function updateClaudeCodeSettings(data: {
  enabled?: boolean;
  authMode?: "api-key" | "oauth";
  apiKey?: string;
  model?: string;
  approvalMode?: "full-auto" | "auto-edit";
  timeoutMs?: number;
  maxTurns?: number;
}): Promise<void> {
  if (data.enabled !== undefined) {
    setConfig("claude-code:enabled", data.enabled ? "true" : "false");
  }
  if (data.authMode !== undefined) {
    setConfig("claude-code:auth_mode", data.authMode);
  }
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig("claude-code:api_key");
    } else {
      setConfig("claude-code:api_key", data.apiKey);
    }
  }
  if (data.model !== undefined) {
    setConfig("claude-code:model", data.model);
  }
  if (data.approvalMode !== undefined) {
    setConfig("claude-code:approval_mode", data.approvalMode);
  }
  if (data.timeoutMs !== undefined) {
    setConfig("claude-code:timeout_ms", String(data.timeoutMs));
  }
  if (data.maxTurns !== undefined) {
    setConfig("claude-code:max_turns", String(data.maxTurns));
  }
}

export async function testClaudeCodeConnection(): Promise<TestResult> {
  const start = Date.now();

  try {
    const { isClaudeCodeInstalled, isClaudeCodeReady } = await import("../coding-agents/claude-code-manager.js");

    if (!isClaudeCodeInstalled()) {
      return { ok: false, error: "Claude Code CLI not found. Install with: curl -fsSL https://claude.ai/install.sh | bash" };
    }

    if (!isClaudeCodeReady()) {
      const authMode = getConfig("claude-code:auth_mode") ?? "api-key";
      if (authMode === "api-key") {
        return { ok: false, error: "API key not configured." };
      }
      return { ok: false, error: "OAuth session not found. Run `claude login` to authenticate." };
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
// Claude Code OAuth usage
// ---------------------------------------------------------------------------

const EMPTY_USAGE: ClaudeCodeOAuthUsage = {
  sessionPercent: 0,
  sessionResetsAt: null,
  weeklyPercent: 0,
  weeklyResetsAt: null,
  errorMessage: null,
  needsAuth: false,
};

let usageCache: { data: ClaudeCodeOAuthUsage; fetchedAt: number } | null = null;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getClaudeCodeOAuthUsage(): Promise<ClaudeCodeOAuthUsage> {
  // Return cached result if fresh
  if (usageCache && Date.now() - usageCache.fetchedAt < USAGE_CACHE_TTL_MS) {
    return usageCache.data;
  }
  const authMode = getConfig("claude-code:auth_mode") ?? "api-key";
  if (authMode !== "oauth") {
    return { ...EMPTY_USAGE, errorMessage: "Not using OAuth" };
  }

  const credPath = join(homedir(), ".claude", ".credentials.json");
  if (!existsSync(credPath)) {
    return { ...EMPTY_USAGE, errorMessage: "Credentials file not found", needsAuth: true };
  }

  let accessToken: string;
  try {
    const raw = JSON.parse(readFileSync(credPath, "utf-8"));
    const oauth = raw?.claudeAiOauth;
    if (!oauth?.accessToken) {
      return { ...EMPTY_USAGE, errorMessage: "No OAuth token found", needsAuth: true };
    }

    // Check expiry (with 60s buffer)
    if (oauth.expiresAt) {
      const expiresAt = new Date(oauth.expiresAt).getTime();
      if (Date.now() > expiresAt - 60_000) {
        return { ...EMPTY_USAGE, errorMessage: "OAuth token expired", needsAuth: true };
      }
    }

    accessToken = oauth.accessToken;
  } catch {
    return { ...EMPTY_USAGE, errorMessage: "Failed to read credentials file", needsAuth: true };
  }

  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.0.32",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401 || res.status === 403) {
      return { ...EMPTY_USAGE, errorMessage: "OAuth token rejected", needsAuth: true };
    }
    if (!res.ok) {
      return { ...EMPTY_USAGE, errorMessage: `API error: ${res.status}` };
    }

    const data = await res.json() as {
      five_hour?: { utilization: number; resets_at: string };
      seven_day?: { utilization: number; resets_at: string };
    };

    // utilization is already a percentage (e.g. 39 = 39%)
    const result: ClaudeCodeOAuthUsage = {
      sessionPercent: Math.round(data.five_hour?.utilization ?? 0),
      sessionResetsAt: data.five_hour?.resets_at ?? null,
      weeklyPercent: Math.round(data.seven_day?.utilization ?? 0),
      weeklyResetsAt: data.seven_day?.resets_at ?? null,
      errorMessage: null,
      needsAuth: false,
    };
    usageCache = { data: result, fetchedAt: Date.now() };
    return result;
  } catch (error) {
    return {
      ...EMPTY_USAGE,
      errorMessage: error instanceof Error ? error.message : "Failed to fetch usage",
    };
  }
}

// ---------------------------------------------------------------------------
// Codex settings
// ---------------------------------------------------------------------------

export interface CodexSettingsResponse {
  enabled: boolean;
  authMode: "api-key" | "oauth";
  apiKeySet: boolean;
  model: string;
  approvalMode: "full-auto" | "suggest" | "ask";
  timeoutMs: number;
}

export function getCodexSettings(): CodexSettingsResponse {
  return {
    enabled: getConfig("codex:enabled") === "true",
    authMode: (getConfig("codex:auth_mode") ?? "api-key") as "api-key" | "oauth",
    apiKeySet: !!getConfig("codex:api_key"),
    model: getConfig("codex:model") ?? "codex-mini",
    approvalMode: (getConfig("codex:approval_mode") ?? "full-auto") as "full-auto" | "suggest" | "ask",
    timeoutMs: parseInt(getConfig("codex:timeout_ms") ?? "1200000", 10),
  };
}

export async function updateCodexSettings(data: {
  enabled?: boolean;
  authMode?: "api-key" | "oauth";
  apiKey?: string;
  model?: string;
  approvalMode?: "full-auto" | "suggest" | "ask";
  timeoutMs?: number;
}): Promise<void> {
  if (data.enabled !== undefined) {
    setConfig("codex:enabled", data.enabled ? "true" : "false");
  }
  if (data.authMode !== undefined) {
    setConfig("codex:auth_mode", data.authMode);
  }
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig("codex:api_key");
    } else {
      setConfig("codex:api_key", data.apiKey);
    }
  }
  if (data.model !== undefined) {
    setConfig("codex:model", data.model);
  }
  if (data.approvalMode !== undefined) {
    setConfig("codex:approval_mode", data.approvalMode);
  }
  if (data.timeoutMs !== undefined) {
    setConfig("codex:timeout_ms", String(data.timeoutMs));
  }
}

export async function testCodexConnection(): Promise<TestResult> {
  const start = Date.now();

  try {
    const { isCodexInstalled, isCodexReady } = await import("../coding-agents/codex-manager.js");

    if (!isCodexInstalled()) {
      return { ok: false, error: "Codex CLI not found. Install with: npm install -g @openai/codex" };
    }

    if (!isCodexReady()) {
      const authMode = getConfig("codex:auth_mode") ?? "api-key";
      if (authMode === "api-key") {
        return { ok: false, error: "API key not configured." };
      }
      return { ok: false, error: "OAuth session not found. Run `codex login` to authenticate." };
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
// Gemini CLI settings
// ---------------------------------------------------------------------------

export interface GeminiCliSettingsResponse {
  enabled: boolean;
  authMode: "api-key" | "oauth";
  apiKeySet: boolean;
  model: string;
  approvalMode: "full-auto" | "auto-edit" | "default";
  timeoutMs: number;
  sandbox: boolean;
}

export function getGeminiCliSettings(): GeminiCliSettingsResponse {
  return {
    enabled: getConfig("gemini-cli:enabled") === "true",
    authMode: (getConfig("gemini-cli:auth_mode") ?? "api-key") as "api-key" | "oauth",
    apiKeySet: !!getConfig("gemini-cli:api_key"),
    model: getConfig("gemini-cli:model") ?? "gemini-2.5-flash",
    approvalMode: (getConfig("gemini-cli:approval_mode") ?? "full-auto") as "full-auto" | "auto-edit" | "default",
    timeoutMs: parseInt(getConfig("gemini-cli:timeout_ms") ?? "1200000", 10),
    sandbox: getConfig("gemini-cli:sandbox") === "true",
  };
}

export async function updateGeminiCliSettings(data: {
  enabled?: boolean;
  authMode?: "api-key" | "oauth";
  apiKey?: string;
  model?: string;
  approvalMode?: "full-auto" | "auto-edit" | "default";
  timeoutMs?: number;
  sandbox?: boolean;
}): Promise<void> {
  if (data.enabled !== undefined) {
    setConfig("gemini-cli:enabled", data.enabled ? "true" : "false");
  }
  if (data.authMode !== undefined) {
    setConfig("gemini-cli:auth_mode", data.authMode);
  }
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig("gemini-cli:api_key");
    } else {
      setConfig("gemini-cli:api_key", data.apiKey);
    }
  }
  if (data.model !== undefined) {
    setConfig("gemini-cli:model", data.model);
  }
  if (data.approvalMode !== undefined) {
    setConfig("gemini-cli:approval_mode", data.approvalMode);
  }
  if (data.timeoutMs !== undefined) {
    setConfig("gemini-cli:timeout_ms", String(data.timeoutMs));
  }
  if (data.sandbox !== undefined) {
    setConfig("gemini-cli:sandbox", data.sandbox ? "true" : "false");
  }
}

export async function testGeminiCliConnection(): Promise<TestResult> {
  const start = Date.now();

  try {
    const { isGeminiCliInstalled, isGeminiCliReady } = await import("../coding-agents/gemini-cli-manager.js");

    if (!isGeminiCliInstalled()) {
      return { ok: false, error: "Gemini CLI not found. It should be pre-installed — try restarting the container." };
    }

    if (!isGeminiCliReady()) {
      const authMode = getConfig("gemini-cli:auth_mode") ?? "api-key";
      if (authMode === "api-key") {
        return { ok: false, error: "API key not configured." };
      }
      return { ok: false, error: "OAuth session not found. Run `gemini login` in a terminal to authenticate." };
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
// GitHub settings
// ---------------------------------------------------------------------------

export interface GitHubSettingsResponse {
  enabled: boolean;
  tokenSet: boolean;
  username: string | null;
  sshKeySet: boolean;
  sshKeyFingerprint: string | null;
  sshKeyType: string | null;
}

export function getGitHubSettings(): GitHubSettingsResponse {
  return {
    enabled: getConfig("github:enabled") === "true",
    tokenSet: !!getConfig("github:token"),
    username: getConfig("github:username") ?? null,
    sshKeySet: existsSync(join(homedir(), ".ssh", "otterbot_github")),
    sshKeyFingerprint: getConfig("github:ssh_fingerprint") ?? null,
    sshKeyType: getConfig("github:ssh_key_type") ?? null,
  };
}

export function updateGitHubSettings(data: {
  enabled?: boolean;
  token?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("github:enabled", data.enabled ? "true" : "false");
  }
  if (data.token !== undefined) {
    if (data.token === "") {
      deleteConfig("github:token");
      deleteConfig("github:username");
    } else {
      setConfig("github:token", data.token);
    }
  }
}

export async function testGitHubConnection(): Promise<TestResult & { username?: string }> {
  const token = getConfig("github:token");
  if (!token) {
    return { ok: false, error: "GitHub token not configured." };
  }

  const start = Date.now();

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Otterbot",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return { ok: false, error: "Invalid token. Check scopes: repo, read:org, workflow" };
      }
      return { ok: false, error: `GitHub API error: ${res.status}` };
    }

    const data = (await res.json()) as { login?: string };
    const username = data.login ?? null;

    if (username) {
      setConfig("github:username", username);
    }

    return { ok: true, latencyMs: Date.now() - start, username: username ?? undefined };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// GitHub SSH key management
// ---------------------------------------------------------------------------

const SSH_KEY_NAME = "otterbot_github";

function sshDir(): string {
  return join(homedir(), ".ssh");
}

function sshKeyPath(): string {
  return join(sshDir(), SSH_KEY_NAME);
}

function sshPubKeyPath(): string {
  return join(sshDir(), `${SSH_KEY_NAME}.pub`);
}

function getFingerprint(pubKeyPath: string): string {
  const out = execSync(`ssh-keygen -lf ${pubKeyPath}`, { encoding: "utf-8" }).trim();
  // Output format: "256 SHA256:xxxxx comment (ED25519)"
  return out.split(" ")[1] ?? out;
}

function configureGitSSH(): void {
  const keyPath = sshKeyPath();
  const pubKeyPath = sshPubKeyPath();
  const sshConfigPath = join(sshDir(), "config");

  // --- ~/.ssh/config entry ---
  const hostBlock = [
    "",
    "# Otterbot GitHub SSH",
    "Host github.com",
    `  IdentityFile ${keyPath}`,
    "  IdentitiesOnly yes",
    "",
  ].join("\n");

  let sshConfig = existsSync(sshConfigPath) ? readFileSync(sshConfigPath, "utf-8") : "";
  // Remove any existing otterbot block
  sshConfig = sshConfig.replace(/\n?# Otterbot GitHub SSH\nHost github\.com\n  IdentityFile [^\n]+\n  IdentitiesOnly yes\n?/g, "");
  sshConfig = sshConfig.trimEnd() + hostBlock;
  writeFileSync(sshConfigPath, sshConfig, { mode: 0o600 });

  // --- git config for commit signing ---
  const gitCmds = [
    `git config --global gpg.format ssh`,
    `git config --global user.signingkey "${pubKeyPath}"`,
    `git config --global commit.gpgsign true`,
    `git config --global tag.gpgsign true`,
  ];
  for (const cmd of gitCmds) {
    execSync(cmd, { stdio: "pipe" });
  }
}

function removeGitSSHConfig(): void {
  // Remove ~/.ssh/config block
  const sshConfigPath = join(sshDir(), "config");
  if (existsSync(sshConfigPath)) {
    let sshConfig = readFileSync(sshConfigPath, "utf-8");
    sshConfig = sshConfig.replace(/\n?# Otterbot GitHub SSH\nHost github\.com\n  IdentityFile [^\n]+\n  IdentitiesOnly yes\n?/g, "");
    writeFileSync(sshConfigPath, sshConfig, { mode: 0o600 });
  }

  // Unset git signing config
  const gitCmds = [
    "git config --global --unset gpg.format",
    "git config --global --unset user.signingkey",
    "git config --global --unset commit.gpgsign",
    "git config --global --unset tag.gpgsign",
  ];
  for (const cmd of gitCmds) {
    try { execSync(cmd, { stdio: "pipe" }); } catch { /* key may not exist */ }
  }
}

export function generateSSHKey(data?: {
  type?: "ed25519" | "rsa";
  comment?: string;
}): { ok: boolean; fingerprint?: string; publicKey?: string; error?: string } {
  const keyType = data?.type ?? "ed25519";
  const comment = data?.comment ?? "otterbot@github";
  const keyPath = sshKeyPath();

  // Ensure ~/.ssh exists
  const dir = sshDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Don't overwrite existing key
  if (existsSync(keyPath)) {
    return { ok: false, error: "SSH key already exists. Remove it first." };
  }

  try {
    execSync(
      `ssh-keygen -t ${keyType} -C "${comment}" -f "${keyPath}" -N ""`,
      { stdio: "pipe" },
    );
    chmodSync(keyPath, 0o600);
    chmodSync(sshPubKeyPath(), 0o644);

    const fingerprint = getFingerprint(sshPubKeyPath());
    const publicKey = readFileSync(sshPubKeyPath(), "utf-8").trim();

    setConfig("github:ssh_fingerprint", fingerprint);
    setConfig("github:ssh_key_type", keyType);

    configureGitSSH();

    return { ok: true, fingerprint, publicKey };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to generate SSH key",
    };
  }
}

export function importSSHKey(privateKey: string): {
  ok: boolean;
  fingerprint?: string;
  publicKey?: string;
  error?: string;
} {
  const keyPath = sshKeyPath();
  const pubKeyPath = sshPubKeyPath();

  const dir = sshDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  if (existsSync(keyPath)) {
    return { ok: false, error: "SSH key already exists. Remove it first." };
  }

  try {
    // Ensure trailing newline
    const normalized = privateKey.trimEnd() + "\n";
    writeFileSync(keyPath, normalized, { mode: 0o600 });

    // Derive public key
    const pubKey = execSync(`ssh-keygen -y -f "${keyPath}"`, { encoding: "utf-8" }).trim();
    writeFileSync(pubKeyPath, pubKey + "\n", { mode: 0o644 });

    const fingerprint = getFingerprint(pubKeyPath);

    // Detect key type from public key line
    const keyType = pubKey.startsWith("ssh-ed25519") ? "ed25519" : "rsa";

    setConfig("github:ssh_fingerprint", fingerprint);
    setConfig("github:ssh_key_type", keyType);

    configureGitSSH();

    return { ok: true, fingerprint, publicKey: pubKey };
  } catch (error) {
    // Clean up on failure
    try { if (existsSync(keyPath)) unlinkSync(keyPath); } catch { /* ignore */ }
    try { if (existsSync(pubKeyPath)) unlinkSync(pubKeyPath); } catch { /* ignore */ }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to import SSH key",
    };
  }
}

export function getSSHPublicKey(): { publicKey: string | null } {
  const pubPath = sshPubKeyPath();
  if (!existsSync(pubPath)) return { publicKey: null };
  return { publicKey: readFileSync(pubPath, "utf-8").trim() };
}

export function removeSSHKey(): { ok: boolean; error?: string } {
  try {
    const keyPath = sshKeyPath();
    const pubPath = sshPubKeyPath();

    if (existsSync(keyPath)) unlinkSync(keyPath);
    if (existsSync(pubPath)) unlinkSync(pubPath);

    deleteConfig("github:ssh_fingerprint");
    deleteConfig("github:ssh_key_type");

    removeGitSSHConfig();

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to remove SSH key",
    };
  }
}

/**
 * Public wrapper around configureGitSSH() — called after restoring SSH keys
 * from a backup archive so that ~/.ssh/config and git signing config are set up.
 */
export function applyGitSSHConfig(): void {
  configureGitSSH();
}

export function testSSHConnection(): { ok: boolean; username?: string; error?: string } {
  try {
    // ssh -T git@github.com exits with code 1 on success (it prints "Hi username!")
    const result = execSync(
      `ssh -T -o StrictHostKeyChecking=accept-new -o BatchMode=yes git@github.com 2>&1`,
      { encoding: "utf-8", timeout: 15_000 },
    ).trim();

    const match = result.match(/Hi (\S+)!/);
    return { ok: true, username: match?.[1] };
  } catch (error: unknown) {
    // ssh -T returns exit code 1 on successful auth
    const stderr = (error as { stdout?: string })?.stdout ?? String(error);
    const match = stderr.match(/Hi (\S+)!/);
    if (match) {
      return { ok: true, username: match[1] };
    }
    return {
      ok: false,
      error: stderr.slice(0, 200) || "SSH connection failed",
    };
  }
}
