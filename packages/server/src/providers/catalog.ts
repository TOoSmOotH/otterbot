import type { LanguageModelV1 } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ProviderInfo } from "@otterbot/shared";
import { getConfig } from "../config.js";
import { HttpEmbedder, type Embedder } from "../embedding.js";
import { BuiltinEmbedder, BUILTIN_MODEL_ID } from "../embedders/builtin-embedder.js";
import { getOpenAiAuth } from "../auth/openai-auth-store.js";
import { listCodexModels } from "../auth/openai-oauth.js";
import { OpenAiCodexOAuthModel } from "./openai-codex-model.js";
import type { ProviderEndpoint } from "./types.js";

/**
 * The provider catalog — the single source of truth for model providers.
 *
 * To add a new provider, add one {@link ProviderDef} to {@link PROVIDER_CATALOG}
 * below. Nothing else needs to change: the registry, the orchestrator, and the
 * web UI all derive from this catalog.
 */

type Secrets = Map<string, string>;

/** A full provider definition: serializable metadata plus runtime factories. */
export interface ProviderDef extends ProviderInfo {
  /** Build a chat model for `modelId`. */
  createChatModel(modelId: string, secrets: Secrets): LanguageModelV1;
  /** Build an embedder for `modelId`. */
  createEmbedder(modelId: string, secrets: Secrets): Embedder;
  /** List the model ids the provider currently serves (for the model picker). */
  listModels(secrets: Secrets): Promise<string[]>;
}

// --- shared helpers -------------------------------------------------------

/** A boot-safe model that throws a clear error only when actually used. */
function unavailableModel(modelId: string, message: string): LanguageModelV1 {
  return {
    specificationVersion: "v1",
    provider: "unavailable",
    modelId,
    defaultObjectGenerationMode: undefined,
    async doGenerate() {
      throw new Error(message);
    },
    async doStream() {
      throw new Error(message);
    },
  };
}

/** Fetch the OpenAI-shaped `{ data: [{ id }] }` model list from an endpoint. */
async function httpListModels(
  ep: ProviderEndpoint,
  headers: Record<string, string>
): Promise<string[]> {
  const res = await fetch(`${ep.baseUrl.replace(/\/+$/, "")}/models`, { headers });
  if (!res.ok) {
    throw new Error(`provider returned ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return [
    ...new Set(
      (body.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ].sort();
}

// --- per-provider endpoint resolution ------------------------------------

function lmstudioEndpoint(secrets: Secrets): ProviderEndpoint {
  const cfg = getConfig();
  return {
    baseUrl: secrets.get("LMSTUDIO_BASE_URL") ?? cfg.lmstudioBaseUrl,
    apiKey: secrets.get("LMSTUDIO_API_KEY") ?? cfg.lmstudioApiKey ?? "lm-studio",
  };
}

function ollamaEndpoint(secrets: Secrets): ProviderEndpoint {
  return {
    baseUrl: secrets.get("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1",
    apiKey: secrets.get("OLLAMA_API_KEY") ?? "ollama",
  };
}

function openaiEndpoint(secrets: Secrets): ProviderEndpoint {
  return {
    baseUrl: secrets.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
    apiKey: secrets.get("OPENAI_API_KEY") ?? "",
  };
}

/** Build a chat + embedder + model-list def for an OpenAI-compatible server. */
function openAiCompatibleProvider(opts: {
  id: string;
  label: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
  defaultBaseUrl: string;
  endpoint: (secrets: Secrets) => ProviderEndpoint;
}): ProviderDef {
  return {
    id: opts.id,
    label: opts.label,
    supportsChat: true,
    supportsEmbeddings: true,
    needsApiKey: false,
    apiKeyEnv: opts.apiKeyEnv,
    baseUrlEnv: opts.baseUrlEnv,
    defaultBaseUrl: opts.defaultBaseUrl,
    createChatModel: (modelId, secrets) => {
      const ep = opts.endpoint(secrets);
      return createOpenAICompatible({
        name: opts.id,
        baseURL: ep.baseUrl,
        apiKey: ep.apiKey,
      }).chatModel(modelId);
    },
    createEmbedder: (modelId, secrets) => {
      const ep = opts.endpoint(secrets);
      return new HttpEmbedder({ baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: modelId });
    },
    listModels: (secrets) => {
      const ep = opts.endpoint(secrets);
      return httpListModels(ep, { authorization: `Bearer ${ep.apiKey}` });
    },
  };
}

// --- provider definitions -------------------------------------------------

const anthropic: ProviderDef = {
  id: "anthropic",
  label: "Anthropic",
  supportsChat: true,
  supportsEmbeddings: false,
  needsApiKey: true,
  apiKeyEnv: "ANTHROPIC_API_KEY",
  baseUrlEnv: "ANTHROPIC_BASE_URL",
  defaultBaseUrl: "https://api.anthropic.com/v1",
  createChatModel: (modelId, secrets) =>
    createAnthropic({
      apiKey: secrets.get("ANTHROPIC_API_KEY") ?? "",
      baseURL: secrets.get("ANTHROPIC_BASE_URL"),
    })(modelId),
  createEmbedder: (modelId, secrets) => {
    // Anthropic has no embeddings API — fall back to a local LM Studio embedder.
    console.warn("[providers] anthropic has no embeddings API; falling back to LM Studio");
    const ep = lmstudioEndpoint(secrets);
    return new HttpEmbedder({ baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: modelId });
  },
  listModels: (secrets) => {
    const ep = {
      baseUrl: secrets.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com/v1",
      apiKey: secrets.get("ANTHROPIC_API_KEY") ?? "",
    };
    return httpListModels(ep, { "x-api-key": ep.apiKey, "anthropic-version": "2023-06-01" });
  },
};

const openai: ProviderDef = {
  id: "openai",
  label: "OpenAI",
  supportsChat: true,
  supportsEmbeddings: true,
  needsApiKey: true,
  apiKeyEnv: "OPENAI_API_KEY",
  baseUrlEnv: "OPENAI_BASE_URL",
  defaultBaseUrl: "https://api.openai.com/v1",
  createChatModel: (modelId, secrets) => {
    // A connected ChatGPT subscription (OAuth) routes through the Codex backend.
    if (secrets.get("OPENAI_AUTH_METHOD") === "oauth") {
      const auth = getOpenAiAuth();
      if (!auth?.isConnected()) {
        return unavailableModel(
          modelId,
          "OpenAI OAuth is selected but no ChatGPT account is connected"
        );
      }
      return new OpenAiCodexOAuthModel(modelId, auth);
    }
    return createOpenAI({
      apiKey: secrets.get("OPENAI_API_KEY") ?? "",
      baseURL: secrets.get("OPENAI_BASE_URL"),
    })(modelId);
  },
  createEmbedder: (modelId, secrets) => {
    const ep = openaiEndpoint(secrets);
    return new HttpEmbedder({ baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: modelId });
  },
  listModels: async (secrets) => {
    if (secrets.get("OPENAI_AUTH_METHOD") === "oauth") {
      const auth = getOpenAiAuth();
      if (!auth?.isConnected()) {
        throw new Error("OpenAI OAuth is selected but no ChatGPT account is connected");
      }
      return listCodexModels(await auth.accessToken());
    }
    const ep = openaiEndpoint(secrets);
    return httpListModels(ep, { authorization: `Bearer ${ep.apiKey}` });
  },
};

const lmstudio = openAiCompatibleProvider({
  id: "lmstudio",
  label: "LM Studio (local)",
  apiKeyEnv: "LMSTUDIO_API_KEY",
  baseUrlEnv: "LMSTUDIO_BASE_URL",
  defaultBaseUrl: "http://localhost:1234/v1",
  endpoint: lmstudioEndpoint,
});

const ollama = openAiCompatibleProvider({
  id: "ollama",
  label: "Ollama (local)",
  apiKeyEnv: "OLLAMA_API_KEY",
  baseUrlEnv: "OLLAMA_BASE_URL",
  defaultBaseUrl: "http://localhost:11434/v1",
  endpoint: ollamaEndpoint,
});

const builtin: ProviderDef = {
  id: "builtin",
  label: "Built-in (CPU)",
  supportsChat: false,
  supportsEmbeddings: true,
  needsApiKey: false,
  apiKeyEnv: null,
  baseUrlEnv: null,
  defaultBaseUrl: null,
  createChatModel: (modelId) =>
    unavailableModel(modelId, "the built-in provider is embedding-only"),
  createEmbedder: () => new BuiltinEmbedder(),
  listModels: async () => [BUILTIN_MODEL_ID],
};

/** Every provider otterbot knows about. Add new providers here. */
export const PROVIDER_CATALOG: ProviderDef[] = [anthropic, openai, lmstudio, ollama, builtin];

// --- lookups --------------------------------------------------------------

/** Look up a provider definition, or `undefined` if the id is unknown. */
export function findProvider(id: string): ProviderDef | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/** Look up a provider definition, throwing if the id is unknown. */
export function getProvider(id: string): ProviderDef {
  const def = findProvider(id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  return def;
}

/** The serializable provider metadata exposed by `GET /api/providers`. */
export function providerCatalogInfo(): ProviderInfo[] {
  return PROVIDER_CATALOG.map((p) => ({
    id: p.id,
    label: p.label,
    supportsChat: p.supportsChat,
    supportsEmbeddings: p.supportsEmbeddings,
    needsApiKey: p.needsApiKey,
    apiKeyEnv: p.apiKeyEnv,
    baseUrlEnv: p.baseUrlEnv,
    defaultBaseUrl: p.defaultBaseUrl,
  }));
}
