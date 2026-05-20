import { describe, it, expect } from "vitest";
import { resolveEmbedder } from "../providers/registry.js";
import { HttpEmbedder, NullEmbedder } from "../embedding.js";
import { BuiltinEmbedder } from "./builtin-embedder.js";

describe("resolveEmbedder", () => {
  const secrets = new Map<string, string>();

  it("returns a NullEmbedder when the modelId is empty (embeddings disabled)", () => {
    expect(resolveEmbedder({ provider: "builtin", account: "default", modelId: "" }, secrets)).toBeInstanceOf(
      NullEmbedder
    );
    expect(resolveEmbedder({ provider: "lmstudio", account: "default", modelId: "   " }, secrets)).toBeInstanceOf(
      NullEmbedder
    );
  });

  it("returns a BuiltinEmbedder for the builtin provider", () => {
    expect(
      resolveEmbedder(
        { provider: "builtin", account: "default", modelId: "all-MiniLM-L6-v2" },
        secrets
      )
    ).toBeInstanceOf(BuiltinEmbedder);
  });

  it("returns an HttpEmbedder for HTTP-backed providers", () => {
    expect(
      resolveEmbedder(
        { provider: "lmstudio", account: "default", modelId: "nomic-embed-text" },
        secrets
      )
    ).toBeInstanceOf(HttpEmbedder);
    expect(
      resolveEmbedder(
        { provider: "openai", account: "default", modelId: "text-embedding-3-small" },
        secrets
      )
    ).toBeInstanceOf(HttpEmbedder);
  });
});

describe("BuiltinEmbedder", () => {
  it("reports null without downloading when the model is not present", async () => {
    // No model has been downloaded in the test environment, so the built-in
    // embedder must stay inert — never auto-fetching the weights.
    const embedder = new BuiltinEmbedder();
    expect(await embedder.probeDimension()).toBeNull();
    expect(await embedder.generate("hello")).toBeNull();
  });
});
