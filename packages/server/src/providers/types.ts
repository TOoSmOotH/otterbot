import type { ProviderId, ModelRef } from "@otterbot/shared";

export type { ProviderId, ModelRef };

/** A resolved OpenAI-compatible HTTP endpoint. */
export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}

/** Human-facing metadata about a provider, for the model picker UI. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Whether this provider needs an API key in the agent's `.env`. */
  needsApiKey: boolean;
  /** Env/`.env` key the provider's credential is read from. */
  apiKeyName?: string;
  /** Whether this provider exposes an embeddings endpoint. */
  supportsEmbeddings: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", label: "Anthropic", needsApiKey: true, apiKeyName: "ANTHROPIC_API_KEY", supportsEmbeddings: false },
  { id: "openai", label: "OpenAI", needsApiKey: true, apiKeyName: "OPENAI_API_KEY", supportsEmbeddings: true },
  { id: "lmstudio", label: "LM Studio (local)", needsApiKey: false, supportsEmbeddings: true },
  { id: "ollama", label: "Ollama (local)", needsApiKey: false, supportsEmbeddings: true },
];
