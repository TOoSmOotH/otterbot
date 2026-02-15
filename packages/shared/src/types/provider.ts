export type ProviderType = "anthropic" | "openai" | "ollama" | "openai-compatible";

export interface NamedProvider {
  id: string;
  name: string;
  type: ProviderType;
  apiKeySet: boolean;
  apiKeyMasked?: string; // "...XXXX"
  baseUrl?: string;
  createdAt: string;
}

export interface ProviderTypeMeta {
  type: ProviderType;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
}
