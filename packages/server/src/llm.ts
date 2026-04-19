import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getConfig } from "./config.js";
import type { LanguageModelV1 } from "ai";

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function provider() {
  if (!_provider) {
    const cfg = getConfig();
    _provider = createOpenAICompatible({
      name: "lmstudio",
      baseURL: cfg.lmstudioBaseUrl,
      // LM Studio doesn't require an API key; pass a placeholder for libs
      // that enforce presence.
      apiKey: cfg.lmstudioApiKey ?? "lm-studio",
    });
  }
  return _provider;
}

export function llm(): LanguageModelV1 {
  return provider().chatModel(getConfig().model);
}

export function hasLlm(): boolean {
  const cfg = getConfig();
  return Boolean(cfg.lmstudioBaseUrl);
}
