import type { ModelRef, ProviderId } from "./agent.js";

export type ThemeId = "obsidian" | "light" | "forest";

export type OpenAiAuthMethod = "api-key" | "oauth";

export interface GlobalProviderSettings {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKey?: string;
  authMethod?: OpenAiAuthMethod;
}

export interface GlobalSettings {
  theme: ThemeId;
  defaultChatModel: ModelRef;
  defaultEmbeddingModel: ModelRef;
  providers: Record<ProviderId, GlobalProviderSettings>;
}
