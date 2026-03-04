import { describe, it, expect } from "vitest";
import type { SetupProviderEntry } from "@otterbot/shared";

describe("SetupProviderEntry type", () => {
  it("accepts a minimal entry with type and name", () => {
    const entry: SetupProviderEntry = { type: "anthropic", name: "My Anthropic" };
    expect(entry.type).toBe("anthropic");
    expect(entry.name).toBe("My Anthropic");
    expect(entry.apiKey).toBeUndefined();
    expect(entry.baseUrl).toBeUndefined();
  });

  it("accepts an entry with all optional fields", () => {
    const entry: SetupProviderEntry = {
      type: "openai-compatible",
      name: "Local LLM",
      apiKey: "sk-test",
      baseUrl: "http://localhost:8080/v1",
    };
    expect(entry.type).toBe("openai-compatible");
    expect(entry.apiKey).toBe("sk-test");
    expect(entry.baseUrl).toBe("http://localhost:8080/v1");
  });

  it("can be stored in an array for multi-provider selection", () => {
    const providers: SetupProviderEntry[] = [
      { type: "anthropic", name: "Anthropic" },
      { type: "openai", name: "OpenAI", apiKey: "sk-123" },
      { type: "ollama", name: "Ollama", baseUrl: "http://localhost:11434/api" },
    ];
    expect(providers).toHaveLength(3);
    expect(providers.map((p) => p.type)).toEqual(["anthropic", "openai", "ollama"]);
  });
});
