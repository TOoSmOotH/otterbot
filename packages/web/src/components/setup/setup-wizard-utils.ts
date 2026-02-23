/** Shared constants and helpers for the setup wizard. */

export const SUGGESTED_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-haiku-4-20250414"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  ollama: ["llama3.1", "mistral", "codellama"],
  openrouter: [
    "anthropic/claude-sonnet-4-5-20250929",
    "openai/gpt-4o",
    "google/gemini-2.0-flash-exp:free",
  ],
  "openai-compatible": [],
};

export const CODING_SUGGESTED_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-5-20250929", "claude-opus-4-20250514"],
  openai: ["gpt-4.1", "gpt-4o", "o3-mini"],
  ollama: ["qwen2.5-coder", "codellama", "deepseek-coder-v2"],
  openrouter: [
    "anthropic/claude-sonnet-4-5-20250929",
    "openai/gpt-4.1",
    "deepseek/deepseek-coder",
  ],
  "openai-compatible": [],
};

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: "Claude models from Anthropic. Requires an API key.",
  openai: "GPT models from OpenAI. Requires an API key.",
  ollama: "Run local models with Ollama. Requires a base URL.",
  openrouter: "Access 200+ models through one API. Requires an OpenRouter API key.",
  "openai-compatible":
    "Any OpenAI-compatible API endpoint. Requires a base URL and optionally an API key.",
};

export const NEEDS_API_KEY = new Set(["anthropic", "openai", "openrouter", "openai-compatible"]);
export const NEEDS_BASE_URL = new Set(["ollama", "openai-compatible"]);

/**
 * Hint text shown below the model input to let users know they can search.
 */
export const MODEL_SEARCH_HINT = "Type to search available models, or enter a custom model name.";

/**
 * Filter a list of model IDs by a case-insensitive substring match.
 */
export function filterModels(models: string[], filter: string): string[] {
  const lower = filter.toLowerCase();
  return models.filter((m) => m.toLowerCase().includes(lower));
}

/**
 * Pick a default model for a provider from its suggestions list.
 */
export function getDefaultModel(
  provider: string,
  suggestions: Record<string, string[]> = SUGGESTED_MODELS,
): string {
  const list = suggestions[provider];
  return list && list.length > 0 ? list[0] : "";
}
