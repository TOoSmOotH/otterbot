import type { LanguageModelV1 } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getConfig } from "../config.js";
import type { EmbeddingConfig } from "../embedding.js";
import type { ModelRef, ProviderEndpoint, ProviderId } from "./types.js";
import type { ModelRef as SharedModelRef } from "@otterbot/shared";
import { randomUUID } from "node:crypto";
import { getOpenAiAuth, type OpenAiAuthStore } from "../auth/openai-auth-store.js";
import { CHATGPT_CODEX_BASE_URL, listCodexModels } from "../auth/openai-oauth.js";

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
      // A connected ChatGPT subscription (OAuth) takes precedence over an API key.
      const auth = getOpenAiAuth();
      if (auth?.isConnected()) {
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
  const sessionId = randomUUID();
  const provider = createOpenAI({
    baseURL: CHATGPT_CODEX_BASE_URL,
    apiKey: "chatgpt-oauth", // placeholder — real auth is injected by fetch below
    fetch: async (input, init) => {
      const token = await auth.accessToken();
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      const account = auth.accountId();
      if (account) headers.set("chatgpt-account-id", account);
      headers.set("openai-beta", "responses=experimental");
      headers.set("originator", "codex_cli_rs");
      headers.set("session_id", sessionId);
      // The Codex backend requires server-side response storage to be off.
      let body = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.stringify({ ...(JSON.parse(body) as object), store: false });
        } catch {
          /* non-JSON body — leave it untouched */
        }
      }
      return fetch(input, { ...init, headers, body });
    },
  });
  return provider.responses(modelId);
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
    default: {
      const exhaustive: never = ref.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
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
  if (provider === "openai") {
    const auth = getOpenAiAuth();
    if (auth?.isConnected()) {
      return listCodexModels(await auth.accessToken());
    }
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
