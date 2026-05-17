import { describe, it, expect } from "vitest";
import { resolveChatModel, resolveEmbeddingConfig, isModelAllowed } from "./registry.js";
import type { ModelRef } from "@otterbot/shared";

describe("provider registry", () => {
  it("resolves a chat model for every provider", () => {
    const refs: ModelRef[] = [
      { provider: "anthropic", modelId: "claude-x" },
      { provider: "openai", modelId: "gpt-x" },
      { provider: "lmstudio", modelId: "local-x" },
      { provider: "ollama", modelId: "llama-x" },
    ];
    for (const ref of refs) {
      const model = resolveChatModel(ref, new Map());
      expect(model).toBeTruthy();
      expect(typeof model.doStream).toBe("function");
    }
  });

  it("reads provider credentials from the agent's secrets map", () => {
    // Should not throw — the key is supplied via secrets, not process.env.
    const model = resolveChatModel(
      { provider: "anthropic", modelId: "claude-x" },
      new Map([["ANTHROPIC_API_KEY", "sk-secret"]])
    );
    expect(model).toBeTruthy();
  });

  it("requires a connected ChatGPT account when OpenAI OAuth is selected", () => {
    expect(() =>
      resolveChatModel(
        { provider: "openai", modelId: "gpt-5" },
        new Map([["OPENAI_AUTH_METHOD", "oauth"]])
      )
    ).toThrow(/OAuth is selected/);
  });

  it("resolves an embeddings endpoint, falling back off anthropic", () => {
    const local = resolveEmbeddingConfig({ provider: "lmstudio", modelId: "nomic" }, new Map());
    expect(local.baseUrl).toContain("/v1");

    const openai = resolveEmbeddingConfig({ provider: "openai", modelId: "text-embed" }, new Map());
    expect(openai.baseUrl).toContain("openai.com");

    // anthropic has no embeddings API — must fall back to a local embedder
    const fallback = resolveEmbeddingConfig({ provider: "anthropic", modelId: "claude" }, new Map());
    expect(fallback.baseUrl).toContain("/v1");
    expect(fallback.baseUrl).not.toContain("openai.com");
  });

  it("enforces the allowedModels allowlist with wildcard support", () => {
    const allow = [
      { provider: "anthropic" as const, modelId: "*" },
      { provider: "lmstudio" as const, modelId: "exact-model" },
    ];
    expect(isModelAllowed({ provider: "anthropic", modelId: "anything" }, allow)).toBe(true);
    expect(isModelAllowed({ provider: "lmstudio", modelId: "exact-model" }, allow)).toBe(true);
    expect(isModelAllowed({ provider: "lmstudio", modelId: "other" }, allow)).toBe(false);
    expect(isModelAllowed({ provider: "openai", modelId: "gpt" }, allow)).toBe(false);
  });
});
