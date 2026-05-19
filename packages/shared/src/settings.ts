import type { ModelRef, ProviderId } from "./agent.js";

export type ThemeId = "obsidian" | "light" | "forest";

export type OpenAiAuthMethod = "api-key" | "oauth";

export interface GlobalProviderSettings {
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKey?: string;
  authMethod?: OpenAiAuthMethod;
}

/**
 * A chat model's context window, keyed by provider + model id. Every agent
 * using that model inherits this window; the conversation-history budget is
 * derived from it.
 */
export interface ModelContextWindow {
  provider: ProviderId;
  modelId: string;
  /** Total context window in tokens. */
  contextWindow: number;
}

export interface GlobalSettings {
  theme: ThemeId;
  defaultChatModel: ModelRef;
  defaultEmbeddingModel: ModelRef;
  /** Per-model context windows — shared by every agent using a given model. */
  modelContextWindows: ModelContextWindow[];
  providers: Record<ProviderId, GlobalProviderSettings>;
}
