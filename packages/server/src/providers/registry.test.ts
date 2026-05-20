import { describe, it, expect } from "vitest";
import { resolveChatModel, resolveEmbedder, isModelAllowed } from "./registry.js";
import { PROVIDER_CATALOG } from "./catalog.js";
import { HttpEmbedder, NullEmbedder } from "../embedding.js";
import { BuiltinEmbedder } from "../embedders/builtin-embedder.js";

describe("provider registry", () => {
  it("resolves a chat model for every chat-capable catalog provider", () => {
    for (const def of PROVIDER_CATALOG.filter((p) => p.supportsChat)) {
      const model = resolveChatModel(
        { provider: def.id, account: "default", modelId: "x" },
        new Map()
      );
      expect(model).toBeTruthy();
      expect(typeof model.doStream).toBe("function");
    }
  });

  it("reads provider credentials from the agent's secrets map", () => {
    // Should not throw — the key is supplied via secrets, not process.env.
    const model = resolveChatModel(
      { provider: "anthropic", account: "default", modelId: "claude-x" },
      new Map([["ANTHROPIC_API_KEY", "sk-secret"]])
    );
    expect(model).toBeTruthy();
  });

  it("resolves a boot-safe unavailable model when OpenAI OAuth is disconnected", async () => {
    const model = resolveChatModel(
      { provider: "openai", account: "default", modelId: "gpt-5" },
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
    expect(
      resolveEmbedder({ provider: "builtin", account: "default", modelId: "" }, new Map())
    ).toBeInstanceOf(NullEmbedder);
    expect(
      resolveEmbedder(
        { provider: "builtin", account: "default", modelId: "all-MiniLM-L6-v2" },
        new Map()
      )
    ).toBeInstanceOf(BuiltinEmbedder);
    expect(
      resolveEmbedder({ provider: "lmstudio", account: "default", modelId: "nomic" }, new Map())
    ).toBeInstanceOf(HttpEmbedder);
  });

  it("enforces the allowedModels allowlist with wildcard support", () => {
    const allow = [
      { provider: "anthropic", account: "*", modelId: "*" },
      { provider: "lmstudio", account: "*", modelId: "exact-model" },
    ];
    expect(
      isModelAllowed({ provider: "anthropic", account: "default", modelId: "anything" }, allow)
    ).toBe(true);
    expect(
      isModelAllowed({ provider: "lmstudio", account: "default", modelId: "exact-model" }, allow)
    ).toBe(true);
    expect(
      isModelAllowed({ provider: "lmstudio", account: "default", modelId: "other" }, allow)
    ).toBe(false);
    expect(
      isModelAllowed({ provider: "openai", account: "default", modelId: "gpt" }, allow)
    ).toBe(false);
  });

  it("matches accounts strictly when the allowlist names them", () => {
    const allow = [{ provider: "openai", account: "personal", modelId: "*" }];
    expect(
      isModelAllowed({ provider: "openai", account: "personal", modelId: "gpt-4o" }, allow)
    ).toBe(true);
    expect(
      isModelAllowed({ provider: "openai", account: "work", modelId: "gpt-4o" }, allow)
    ).toBe(false);
  });
});
