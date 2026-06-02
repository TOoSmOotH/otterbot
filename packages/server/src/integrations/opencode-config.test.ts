import { describe, expect, it } from "vitest";
import { buildOpencodeConfig } from "./opencode-config.js";

describe("buildOpencodeConfig", () => {
  it("registers each provider as an openai-compatible entry", () => {
    const cfg = buildOpencodeConfig([
      { id: "opencode-go", label: "OpenCode Zen (Go)", baseUrl: "https://opencode.ai/zen/go/v1", apiKey: "sk-x" },
      { id: "lmstudio", label: "LM Studio", baseUrl: "http://host:1234/v1", apiKey: "lm-studio" },
    ]);
    expect(cfg.$schema).toBe("https://opencode.ai/config.json");
    expect(cfg.provider["opencode-go"]).toEqual({
      npm: "@ai-sdk/openai-compatible",
      name: "OpenCode Zen (Go)",
      options: { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-x" },
    });
    expect(cfg.provider.lmstudio.options.baseURL).toBe("http://host:1234/v1");
  });

  it("skips entries without a base URL", () => {
    const cfg = buildOpencodeConfig([
      { id: "broken", label: "Broken", baseUrl: "", apiKey: "k" },
      { id: "ok", label: "OK", baseUrl: "http://x/v1", apiKey: "k" },
    ]);
    expect(cfg.provider.broken).toBeUndefined();
    expect(cfg.provider.ok).toBeDefined();
  });

  it("substitutes a placeholder key for keyless endpoints", () => {
    const cfg = buildOpencodeConfig([
      { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1", apiKey: "" },
    ]);
    expect(cfg.provider.ollama.options.apiKey).toBe("otterbot");
  });
});
