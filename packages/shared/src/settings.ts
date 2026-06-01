import type { ProviderId } from "./agent.js";

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
  /**
   * A masked preview of the saved API key (e.g. `sk-or…a1b2`) so the user can
   * tell which key is assigned without exposing it. Derived server-side on
   * read; never sent up or persisted.
   */
  apiKeyHint?: string;
  authMethod?: OpenAiAuthMethod;
}

/**
 * A model the user has configured and named — the unit agents select by id.
 * Each one is tied to a single provider account; the orchestrator resolves it
 * to a {@link ModelRef} when building a runtime. Editing an entry propagates to
 * every agent referencing it (agents store only `id`).
 */
export interface ConfiguredModel {
  /** Stable slug, generated on create; referenced by AgentModelConfig. */
  id: string;
  /** Display name shown in every model picker. */
  label: string;
  provider: ProviderId;
  /** Names a {@link ProviderAccount} in providers[provider]. */
  account: string;
  /** Provider-specific model id. */
  modelId: string;
  kind: "chat" | "embedding";
  /** Total context window in tokens (chat only). */
  contextWindow?: number;
}

/**
 * A coding-CLI tool id. Mirrors the server's `CodingTool` union (kept here so
 * shared types can reference it without depending on the server package).
 */
export type CodingToolId = "claude" | "codex" | "gemini" | "opencode";

/**
 * A named, reusable model configuration for one coding CLI tool. Defined once in
 * Settings → Coding Models and assigned to agents (or project roles); resolved
 * into that tool's model-selection flags at spawn time. Each tool exposes
 * different knobs, so fields are optional and tool-specific:
 *  - claude / codex — `model` + `effort` (reasoning effort)
 *  - gemini — `model`
 *  - opencode — `providerModel` (a "provider/model" string)
 */
export interface CodingModelPreset {
  /** Stable slug, generated on create. */
  id: string;
  /** Display name shown in every preset picker, e.g. "Claude Opus · High". */
  label: string;
  /** Which CLI this preset targets; implies the tool to run. */
  tool: CodingToolId;
  /** Model alias/id — claude (`opus`/`sonnet`/…), codex, gemini. */
  model?: string;
  /** Reasoning effort — claude (`--effort`) and codex (`model_reasoning_effort`) only. */
  effort?: string;
  /** opencode only: the resolved `provider/model` string passed to `-m`. */
  providerModel?: string;
  /** opencode only: id of the {@link ConfiguredModel} it was derived from (reference). */
  registryModelId?: string;
}

export interface GlobalSettings {
  theme: ThemeId;
  /** Registry of named models agents pick from. */
  models: ConfiguredModel[];
  /** id of the {@link ConfiguredModel} new agents use for chat ("" if none). */
  defaultChatModelId: string;
  /** id of the {@link ConfiguredModel} new agents use for embeddings ("" if none). */
  defaultEmbeddingModelId: string;
  /** Per-provider list of named credential sets (accounts). */
  providers: Record<ProviderId, ProviderAccount[]>;
  /** Named, reusable per-tool model presets for the coding CLIs. */
  codingModelPresets: CodingModelPreset[];
}
