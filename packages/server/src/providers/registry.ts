import type { LanguageModelV1 } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getConfig } from "../config.js";
import type { EmbeddingConfig } from "../embedding.js";
import type { ModelRef, ProviderEndpoint } from "./types.js";
import type { ModelRef as SharedModelRef } from "@otterbot/shared";

/** Read a secret from the agent's `.env` map, falling back to the process env. */
function secret(secrets: Map<string, string>, key: string): string {
  return secrets.get(key) ?? process.env[key] ?? "";
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
      const anthropic = createAnthropic({ apiKey: secret(secrets, "ANTHROPIC_API_KEY") });
      return anthropic(ref.modelId);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: secret(secrets, "OPENAI_API_KEY") });
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
        baseUrl: "https://api.openai.com/v1",
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

/** Check a `ModelRef` against an allowlist. `"*"` matches any model for a provider. */
export function isModelAllowed(
  ref: ModelRef | SharedModelRef,
  allowed: Array<ModelRef | SharedModelRef>
): boolean {
  return allowed.some(
    (a) => a.provider === ref.provider && (a.modelId === "*" || a.modelId === ref.modelId)
  );
}
