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
  /**
   * Default chat-model context window (tokens) for agents that don't set their
   * own. The conversation-history budget is derived from this.
   */
  defaultContextWindow: number;
  providers: Record<ProviderId, GlobalProviderSettings>;
}
