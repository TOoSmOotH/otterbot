import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Hugging Face LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a Hugging Face language model via OpenAI-compatible SDK
 * - Provider credentials are resolved properly (API token auth)
 * - Configuration (provider type metadata, fallback models) is correct
 * - Model selection passes through the correct model IDs
 */

// ---------------------------------------------------------------------------
// Mock the DB and auth layers so we can test resolveModel in isolation
// ---------------------------------------------------------------------------

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => undefined,
        }),
      }),
    }),
  })),
  schema: {
    providers: { id: "id" },
  },
}));

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock the AI SDK providers to avoid real API calls
// ---------------------------------------------------------------------------

const mockHuggingFaceModel = { modelId: "meta-llama/Llama-3.1-8B-Instruct", provider: "huggingface" };
const mockCreateOpenAICompatible = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockHuggingFaceModel, modelId: model })),
);

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

// Also mock other providers that are imported at module level
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => vi.fn()),
}));

describe("Hugging Face provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a Hugging Face model via OpenAI-compatible SDK", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "huggingface",
        model: "meta-llama/Llama-3.1-8B-Instruct",
        apiKey: "hf_test_token_123",
      });

      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: "huggingface",
        baseURL: "https://api-inference.huggingface.co/v1",
        apiKey: "hf_test_token_123",
      });
      expect(model).toMatchObject({ modelId: "meta-llama/Llama-3.1-8B-Instruct" });
    });

    it("passes the correct model ID for different HF models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "huggingface",
        model: "mistralai/Mistral-7B-Instruct-v0.3",
        apiKey: "hf_key",
      });

      expect(model).toMatchObject({ modelId: "mistralai/Mistral-7B-Instruct-v0.3" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "huggingface",
        model: "meta-llama/Llama-3.1-8B-Instruct",
      });

      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: "huggingface",
        baseURL: "https://api-inference.huggingface.co/v1",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "huggingface",
        model: "meta-llama/Llama-3.1-8B-Instruct",
        apiKey: "hf_key",
        baseUrl: "https://custom-hf-endpoint.example.com/v1",
      });

      expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
        name: "huggingface",
        baseURL: "https://custom-hf-endpoint.example.com/v1",
        apiKey: "hf_key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("huggingface");
      expect(creds.type).toBe("huggingface");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Hugging Face models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "huggingface", model: "meta-llama/Llama-3.1-8B-Instruct" })).toBe(false);
      expect(isThinkingModel({ provider: "huggingface", model: "mistralai/Mistral-7B-Instruct-v0.3" })).toBe(false);
    });
  });
});

describe("Hugging Face provider configuration", () => {
  it("includes huggingface in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const hfMeta = PROVIDER_TYPE_META.find((m) => m.type === "huggingface");
    expect(hfMeta).toBeDefined();
    expect(hfMeta!.label).toBe("Hugging Face");
    expect(hfMeta!.needsApiKey).toBe(true);
    expect(hfMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for huggingface provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("huggingface");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("meta-llama/Llama-3.1-8B-Instruct");
    expect(models).toContain("mistralai/Mistral-7B-Instruct-v0.3");
  });
});

describe("Hugging Face error handling", () => {
  it("throws for unknown provider type", async () => {
    const { resolveModel } = await import("../adapter.js");

    expect(() =>
      resolveModel({
        provider: "nonexistent-provider",
        model: "some-model",
      }),
    ).toThrow(/Unknown LLM provider/);
  });
});
