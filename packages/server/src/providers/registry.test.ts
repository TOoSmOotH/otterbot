import { describe, it, expect } from "vitest";
import { resolveChatModel, resolveEmbedder, isModelAllowed } from "./registry.js";
import { PROVIDER_CATALOG } from "./catalog.js";
import { HttpEmbedder, NullEmbedder } from "../embedding.js";
import { BuiltinEmbedder } from "../embedders/builtin-embedder.js";

describe("provider registry", () => {
  it("resolves a chat model for every chat-capable catalog provider", () => {
    for (const def of PROVIDER_CATALOG.filter((p) => p.supportsChat)) {
      const model = resolveChatModel({ provider: def.id, modelId: "x" }, new Map());
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

  it("resolves a boot-safe unavailable model when OpenAI OAuth is disconnected", async () => {
    const model = resolveChatModel(
      { provider: "openai", modelId: "gpt-5" },
      new Map([["OPENAI_AUTH_METHOD", "oauth"]])
    );
    await expect(
      model.doGenerate({
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [],
      })
    ).rejects.toThrow(/OAuth is selected/);
  });

  it("resolves embedders by provider, disabling them on an empty modelId", () => {
    expect(resolveEmbedder({ provider: "builtin", modelId: "" }, new Map())).toBeInstanceOf(
      NullEmbedder
    );
    expect(
      resolveEmbedder({ provider: "builtin", modelId: "all-MiniLM-L6-v2" }, new Map())
    ).toBeInstanceOf(BuiltinEmbedder);
    expect(resolveEmbedder({ provider: "lmstudio", modelId: "nomic" }, new Map())).toBeInstanceOf(
      HttpEmbedder
    );
  });

  it("enforces the allowedModels allowlist with wildcard support", () => {
    const allow = [
      { provider: "anthropic", modelId: "*" },
      { provider: "lmstudio", modelId: "exact-model" },
    ];
    expect(isModelAllowed({ provider: "anthropic", modelId: "anything" }, allow)).toBe(true);
    expect(isModelAllowed({ provider: "lmstudio", modelId: "exact-model" }, allow)).toBe(true);
    expect(isModelAllowed({ provider: "lmstudio", modelId: "other" }, allow)).toBe(false);
    expect(isModelAllowed({ provider: "openai", modelId: "gpt" }, allow)).toBe(false);
  });
});
