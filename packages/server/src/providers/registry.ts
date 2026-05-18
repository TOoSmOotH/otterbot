import type { LanguageModelV1 } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getConfig } from "../config.js";
import { HttpEmbedder, NullEmbedder, type Embedder, type EmbeddingConfig } from "../embedding.js";
import { BuiltinEmbedder, BUILTIN_MODEL_ID } from "../embedders/builtin-embedder.js";
import type { ModelRef, ProviderEndpoint, ProviderId } from "./types.js";
import type { ModelRef as SharedModelRef } from "@otterbot/shared";
import { getOpenAiAuth, type OpenAiAuthStore } from "../auth/openai-auth-store.js";
import { listCodexModels } from "../auth/openai-oauth.js";
import { OpenAiCodexOAuthModel } from "./openai-codex-model.js";

/** Read a credential from the agent's secrets (stored in the encrypted DB). */
function secret(secrets: Map<string, string>, key: string): string {
  return secrets.get(key) ?? "";
}

function lmstudioEndpoint(secrets: Map<string, string>): ProviderEndpoint {
  const cfg = getConfig();
  return {
    baseUrl: secrets.get("LMSTUDIO_BASE_URL") ?? cfg.lmstudioBaseUrl,
    apiKey: secrets.get("LMSTUDIO_API_KEY") ?? cfg.lmstudioApiKey ?? "lm-studio",
  };
}

function ollamaEndpoint(secrets: Map<string, string>): ProviderEndpoint {
  return {
    baseUrl: secrets.get("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1",
    apiKey: secrets.get("OLLAMA_API_KEY") ?? "ollama",
  };
}

function openAiUsesOAuth(secrets: Map<string, string>): boolean {
  return secrets.get("OPENAI_AUTH_METHOD") === "oauth";
}

/**
 * Resolve a `ModelRef` to an AI-SDK `LanguageModelV1`. Supports cloud providers
 * (Anthropic, OpenAI) and local OpenAI-compatible servers (LM Studio, Ollama).
 * Credentials come from the agent's own secrets map.
 */
export function resolveChatModel(
  ref: ModelRef | SharedModelRef,
  secrets: Map<string, string>
): LanguageModelV1 {
  switch (ref.provider) {
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: secret(secrets, "ANTHROPIC_API_KEY"),
        baseURL: secrets.get("ANTHROPIC_BASE_URL"),
      });
      return anthropic(ref.modelId);
    }
    case "openai": {
      if (openAiUsesOAuth(secrets)) {
        const auth = getOpenAiAuth();
        if (!auth?.isConnected()) {
          return unavailableModel(ref.modelId, "OpenAI OAuth is selected but no ChatGPT account is connected");
        }
        return chatGptCodexModel(ref.modelId, auth);
      }
      const openai = createOpenAI({
        apiKey: secret(secrets, "OPENAI_API_KEY"),
        baseURL: secrets.get("OPENAI_BASE_URL"),
      });
      return openai(ref.modelId);
    }
    case "lmstudio": {
      const ep = lmstudioEndpoint(secrets);
      return createOpenAICompatible({
        name: "lmstudio",
        baseURL: ep.baseUrl,
        apiKey: ep.apiKey,
      }).chatModel(ref.modelId);
    }
    case "ollama": {
      const ep = ollamaEndpoint(secrets);
      return createOpenAICompatible({
        name: "ollama",
        baseURL: ep.baseUrl,
        apiKey: ep.apiKey,
      }).chatModel(ref.modelId);
    }
    case "builtin":
      return unavailableModel(ref.modelId, "the built-in provider is embedding-only");
    default: {
      const exhaustive: never = ref.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * An OpenAI model backed by a ChatGPT subscription (OAuth) rather than an API
 * key. Routes through the ChatGPT Codex Responses backend, mirroring how the
 * Codex CLI (and Hermes Agent) talk to it: bearer token + account id, the
 * `codex_cli_rs` originator, a per-conversation `session_id`, and `store: false`
 * forced into every request body. The token is injected — and refreshed — per
 * request by the custom `fetch`.
 *
 * This path is unofficial (the OAuth flow is meant for the Codex CLI); treat
 * failures here as a sign the upstream contract changed.
 */
function chatGptCodexModel(modelId: string, auth: OpenAiAuthStore): LanguageModelV1 {
  return new OpenAiCodexOAuthModel(modelId, auth);
}

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

/**
 * Resolve a `ModelRef` to an embeddings endpoint config for `EmbeddingService`.
 * Anthropic has no embeddings API — agents using a Claude chat model should
 * pair it with a local embedder; if they don't, we fall back to LM Studio.
 */
export function resolveEmbeddingConfig(
  ref: ModelRef | SharedModelRef,
  secrets: Map<string, string>
): EmbeddingConfig {
  switch (ref.provider) {
    case "lmstudio": {
      const ep = lmstudioEndpoint(secrets);
      return { baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ref.modelId };
    }
    case "ollama": {
      const ep = ollamaEndpoint(secrets);
      return { baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ref.modelId };
    }
    case "openai": {
      return {
        baseUrl: secrets.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
        apiKey: secret(secrets, "OPENAI_API_KEY"),
        model: ref.modelId,
      };
    }
    case "anthropic": {
      console.warn(
        "[providers] anthropic has no embeddings API; falling back to local LM Studio embedder"
      );
      const ep = lmstudioEndpoint(secrets);
      return { baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: ref.modelId };
    }
    case "builtin":
      // The built-in embedder runs in-process — it has no HTTP endpoint.
      // `resolveEmbedder` handles `builtin` before reaching here.
      throw new Error("builtin embeddings are in-process; resolveEmbeddingConfig does not apply");
    default: {
      const exhaustive: never = ref.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * Resolve an embedding `ModelRef` to a runnable {@link Embedder}. An empty
 * `modelId` means the agent has embeddings disabled (FTS-only memory); the
 * `builtin` provider runs in-process; everything else talks HTTP.
 */
export function resolveEmbedder(
  ref: ModelRef | SharedModelRef,
  secrets: Map<string, string>
): Embedder {
  if (!ref.modelId.trim()) return new NullEmbedder();
  if (ref.provider === "builtin") return new BuiltinEmbedder();
  return new HttpEmbedder(resolveEmbeddingConfig(ref, secrets));
}

/**
 * Resolve a provider to its OpenAI-compatible HTTP endpoint. Used to talk to a
 * provider directly (e.g. listing models) rather than through the AI SDK.
 */
export function resolveProviderEndpoint(
  provider: ProviderId,
  secrets: Map<string, string>
): ProviderEndpoint {
  switch (provider) {
    case "lmstudio":
      return lmstudioEndpoint(secrets);
    case "ollama":
      return ollamaEndpoint(secrets);
    case "openai":
      return {
        baseUrl: secrets.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
        apiKey: secret(secrets, "OPENAI_API_KEY"),
      };
    case "anthropic":
      return {
        baseUrl: secrets.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com/v1",
        apiKey: secret(secrets, "ANTHROPIC_API_KEY"),
      };
    case "builtin":
      throw new Error("the built-in provider has no HTTP endpoint");
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}

/**
 * List the model ids a provider currently serves by calling its `/models`
 * endpoint. Local servers (LM Studio, Ollama) and OpenAI use the OpenAI-shaped
 * `{ data: [{ id }] }` response; Anthropic uses its own auth header. When a
 * ChatGPT subscription is connected, OpenAI resolves to the Codex catalogue.
 */
export async function listProviderModels(
  provider: ProviderId,
  secrets: Map<string, string>
): Promise<string[]> {
  if (provider === "builtin") {
    return [BUILTIN_MODEL_ID];
  }
  if (provider === "openai" && openAiUsesOAuth(secrets)) {
    const auth = getOpenAiAuth();
    if (!auth?.isConnected()) {
      throw new Error("OpenAI OAuth is selected but no ChatGPT account is connected");
    }
    return listCodexModels(await auth.accessToken());
  }
  const ep = resolveProviderEndpoint(provider, secrets);
  const headers: Record<string, string> =
    provider === "anthropic"
      ? { "x-api-key": ep.apiKey, "anthropic-version": "2023-06-01" }
      : { authorization: `Bearer ${ep.apiKey}` };
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

/** Check a `ModelRef` against an allowlist. `"*"` matches any model for a provider. */
export function isModelAllowed(
  ref: ModelRef | SharedModelRef,
  allowed: Array<ModelRef | SharedModelRef>
): boolean {
  return allowed.some(
    (a) => a.provider === ref.provider && (a.modelId === "*" || a.modelId === ref.modelId)
  );
}
