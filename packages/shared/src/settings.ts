import type { ModelRef, ProviderId } from "./agent.js";

export type ThemeId = "obsidian" | "light" | "forest";

export type OpenAiAuthMethod = "api-key" | "oauth";

/**
 * One named credential set for a provider. Users may configure multiple
 * accounts per provider type (e.g. an `"personal"` and a `"work"` OpenAI key);
 * each {@link ModelRef} names which account it uses via `ref.account`. The
 * `"default"` account is the auto-created first one.
 */
export interface ProviderAccount {
  /** Unique label within this provider type. */
  account: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  apiKey?: string;
  authMethod?: OpenAiAuthMethod;
}

/**
 * A chat model's context window, keyed by provider + model id. Every agent
 * using that model inherits this window; the conversation-history budget is
 * derived from it. Context windows are a property of the model itself, so
 * they are NOT keyed by account — all accounts of the same provider serving
 * the same model id share one window.
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
  /** Per-provider list of named credential sets (accounts). */
  providers: Record<ProviderId, ProviderAccount[]>;
}
