export type ProviderType = "anthropic" | "openai" | "google" | "ollama" | "openai-compatible" | "openrouter";

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

export interface CustomModel {
  id: string;
  providerId: string;
  modelId: string;
  label?: string;
  createdAt: string;
}

export interface ModelOption {
  modelId: string;
  label?: string;
  source: "discovered" | "custom";
}

/** Per-agent-type model/provider override (stored in config table) */
export interface AgentModelOverride {
  registryEntryId: string;
  provider: string;
  model: string;
}
