import type { ModelRef, ProviderId } from "./agent.js";

export type ThemeId = "obsidian" | "light" | "forest";

export interface GlobalProviderSettings {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKey?: string;
}

export interface GlobalSettings {
  theme: ThemeId;
  defaultChatModel: ModelRef;
  defaultEmbeddingModel: ModelRef;
  providers: Record<ProviderId, GlobalProviderSettings>;
}

