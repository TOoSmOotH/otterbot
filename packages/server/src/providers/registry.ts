import type { LanguageModelV1 } from "ai";
import type { ModelRef } from "@otterbot/shared";
import { NullEmbedder, type Embedder } from "../embedding.js";
import { getProvider } from "./catalog.js";

/**
 * Thin facade over the provider catalog (`./catalog.ts`). Resolution is fully
 * data-driven — adding a provider means adding a catalog entry, nothing here.
 */

/** Resolve a `ModelRef` to an AI-SDK `LanguageModelV1`. */
export function resolveChatModel(ref: ModelRef, secrets: Map<string, string>): LanguageModelV1 {
  return getProvider(ref.provider).createChatModel(ref.modelId, secrets);
}

/**
 * Resolve an embedding `ModelRef` to a runnable `Embedder`. An empty `modelId`
 * means the agent has embeddings disabled (FTS-only memory).
 */
export function resolveEmbedder(ref: ModelRef, secrets: Map<string, string>): Embedder {
  if (!ref.modelId.trim()) return new NullEmbedder();
  return getProvider(ref.provider).createEmbedder(ref.modelId, secrets);
}

/** List the model ids a provider currently serves (for the model picker). */
export function listProviderModels(
  provider: string,
  secrets: Map<string, string>
): Promise<string[]> {
  return getProvider(provider).listModels(secrets);
}

/** Check a `ModelRef` against an allowlist. `"*"` matches any model for a provider. */
export function isModelAllowed(ref: ModelRef, allowed: ModelRef[]): boolean {
  return allowed.some(
    (a) => a.provider === ref.provider && (a.modelId === "*" || a.modelId === ref.modelId)
  );
}
