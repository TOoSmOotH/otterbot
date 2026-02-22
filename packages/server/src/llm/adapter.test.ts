import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock external dependencies so we can unit-test resolveModel / isThinkingModel
// without a real database or provider SDK.
// ---------------------------------------------------------------------------

// Mock the DB module — resolveProviderCredentials calls getDb()
vi.mock("../db/index.js", () => ({
  getDb: vi.fn(() => {
    throw new Error("DB not initialized");
  }),
  schema: { providers: {} },
}));

// Mock the auth/config module — legacy fallback in resolveProviderCredentials
vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
}));

// Capture calls to provider factories so we can verify the adapter wires them correctly
const mockAnthropicModel = { modelId: "anthropic-model" };
const mockAnthropicFactory = vi.fn(() => mockAnthropicModel);
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => mockAnthropicFactory),
}));

const mockOpenAIModel = { modelId: "openai-model" };
const mockOpenAIFactory = vi.fn(() => mockOpenAIModel);
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => mockOpenAIFactory),
}));

const mockGoogleModel = { modelId: "google-model" };
const mockGoogleFactory = vi.fn(() => mockGoogleModel);
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => mockGoogleFactory),
}));

const mockOllamaModel = { modelId: "ollama-model" };
const mockOllamaFactory = vi.fn(() => mockOllamaModel);
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => mockOllamaFactory),
}));

const mockCompatibleModel = { modelId: "compatible-model" };
const mockCompatibleFactory = vi.fn(() => mockCompatibleModel);
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => mockCompatibleFactory),
}));

import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { resolveModel, isThinkingModel, type LLMConfig } from "./adapter.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adapter – resolveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an OpenAI-based model for github-copilot provider type", () => {
    const config: LLMConfig = {
      provider: "github-copilot",
      model: "gpt-4o",
      apiKey: "ghp_test_token",
    };

    const model = resolveModel(config);

    // Should have called createOpenAI with the Copilot base URL
    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: "https://api.githubcopilot.com",
      apiKey: "ghp_test_token",
    });

    // The factory should have been called with the model name
    expect(mockOpenAIFactory).toHaveBeenCalledWith("gpt-4o");
    expect(model).toBe(mockOpenAIModel);
  });

  it("allows overriding the github-copilot baseUrl", () => {
    const config: LLMConfig = {
      provider: "github-copilot",
      model: "gpt-4.1",
      apiKey: "ghp_custom",
      baseUrl: "https://custom-copilot-proxy.example.com",
    };

    resolveModel(config);

    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: "https://custom-copilot-proxy.example.com",
      apiKey: "ghp_custom",
    });
    expect(mockOpenAIFactory).toHaveBeenCalledWith("gpt-4.1");
  });

  it("uses empty string for apiKey when none provided", () => {
    const config: LLMConfig = {
      provider: "github-copilot",
      model: "o3-mini",
    };

    resolveModel(config);

    expect(createOpenAI).toHaveBeenCalledWith({
      baseURL: "https://api.githubcopilot.com",
      apiKey: "",
    });
  });

  it("creates an OpenAI-compatible model for huggingface provider type", () => {
    const config: LLMConfig = {
      provider: "huggingface",
      model: "meta-llama/Llama-3.1-8B-Instruct",
      apiKey: "hf_test_token",
    };

    const model = resolveModel(config);

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "huggingface",
      baseURL: "https://api-inference.huggingface.co/v1",
      apiKey: "hf_test_token",
    });
    expect(mockCompatibleFactory).toHaveBeenCalledWith("meta-llama/Llama-3.1-8B-Instruct");
    expect(model).toBe(mockCompatibleModel);
  });

  it("allows overriding the huggingface baseUrl", () => {
    const config: LLMConfig = {
      provider: "huggingface",
      model: "mistralai/Mistral-7B-Instruct-v0.3",
      apiKey: "hf_custom",
      baseUrl: "https://my-hf-endpoint.example.com/v1",
    };

    resolveModel(config);

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "huggingface",
      baseURL: "https://my-hf-endpoint.example.com/v1",
      apiKey: "hf_custom",
    });
    expect(mockCompatibleFactory).toHaveBeenCalledWith("mistralai/Mistral-7B-Instruct-v0.3");
  });

  it("uses empty string for apiKey when none provided for huggingface", () => {
    const config: LLMConfig = {
      provider: "huggingface",
      model: "Qwen/Qwen2.5-72B-Instruct",
    };

    resolveModel(config);

    expect(createOpenAICompatible).toHaveBeenCalledWith({
      name: "huggingface",
      baseURL: "https://api-inference.huggingface.co/v1",
      apiKey: "",
    });
  });

  it("throws for unknown provider type", () => {
    const config: LLMConfig = {
      provider: "nonexistent",
      model: "some-model",
    };

    expect(() => resolveModel(config)).toThrow(/Unknown LLM provider/);
  });
});

describe("adapter – isThinkingModel", () => {
  it("returns false for github-copilot models", () => {
    expect(
      isThinkingModel({ provider: "github-copilot", model: "gpt-4o" }),
    ).toBe(false);
    expect(
      isThinkingModel({ provider: "github-copilot", model: "claude-sonnet-4-5-20250929" }),
    ).toBe(false);
  });

  it("returns true for anthropic thinking models", () => {
    expect(
      isThinkingModel({ provider: "anthropic", model: "claude-sonnet-4-5-20250929" }),
    ).toBe(true);
    expect(
      isThinkingModel({ provider: "anthropic", model: "claude-opus-4-20250514" }),
    ).toBe(true);
  });

  it("returns false for non-thinking anthropic models", () => {
    expect(
      isThinkingModel({ provider: "anthropic", model: "claude-haiku-4-20250414" }),
    ).toBe(false);
  });

  it("returns true for openrouter anthropic thinking models", () => {
    expect(
      isThinkingModel({ provider: "openrouter", model: "anthropic/claude-sonnet-4-5-20250929" }),
    ).toBe(true);
  });

  it("returns false for openrouter non-anthropic models", () => {
    expect(
      isThinkingModel({ provider: "openrouter", model: "openai/gpt-4o" }),
    ).toBe(false);
  });

  it("returns false for huggingface models", () => {
    expect(
      isThinkingModel({ provider: "huggingface", model: "meta-llama/Llama-3.1-8B-Instruct" }),
    ).toBe(false);
  });
});
