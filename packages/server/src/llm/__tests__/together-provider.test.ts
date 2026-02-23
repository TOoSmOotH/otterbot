import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Together AI LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a Together AI language model via OpenAI SDK
 * - Provider credentials are resolved properly (API key auth)
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

const mockTogetherModel = { modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo", provider: "together" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockTogetherModel, modelId: model })),
);

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mockCreateOpenAI,
}));

// Also mock other providers that are imported at module level
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn()),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => vi.fn()),
}));

describe("Together AI provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a Together AI model via OpenAI SDK with correct base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "together",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        apiKey: "together_test_key_123",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.together.xyz/v1",
        apiKey: "together_test_key_123",
      });
      expect(model).toMatchObject({ modelId: "meta-llama/Llama-3.3-70B-Instruct-Turbo" });
    });

    it("passes the correct model ID for DeepSeek models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "together",
        model: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
        apiKey: "key",
      });

      expect(model).toMatchObject({ modelId: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B" });
    });

    it("passes the correct model ID for Mixtral models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "together",
        model: "mistralai/Mixtral-8x22B-Instruct-v0.1",
        apiKey: "key",
      });

      expect(model).toMatchObject({ modelId: "mistralai/Mixtral-8x22B-Instruct-v0.1" });
    });

    it("passes the correct model ID for Qwen models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "together",
        model: "Qwen/Qwen2.5-72B-Instruct-Turbo",
        apiKey: "key",
      });

      expect(model).toMatchObject({ modelId: "Qwen/Qwen2.5-72B-Instruct-Turbo" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "together",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.together.xyz/v1",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "together",
        model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        apiKey: "key",
        baseUrl: "https://custom-together.example.com/v1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://custom-together.example.com/v1",
        apiKey: "key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("together");
      expect(creds.type).toBe("together");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Together AI models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" })).toBe(false);
      expect(isThinkingModel({ provider: "together", model: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B" })).toBe(false);
      expect(isThinkingModel({ provider: "together", model: "Qwen/Qwen2.5-72B-Instruct-Turbo" })).toBe(false);
    });
  });
});

describe("Together AI provider configuration", () => {
  it("includes together in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const togetherMeta = PROVIDER_TYPE_META.find((m) => m.type === "together");
    expect(togetherMeta).toBeDefined();
    expect(togetherMeta!.label).toBe("Together AI");
    expect(togetherMeta!.needsApiKey).toBe(true);
    expect(togetherMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for together provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("together");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("meta-llama/Llama-3.3-70B-Instruct-Turbo");
    expect(models).toContain("deepseek-ai/DeepSeek-R1-Distill-Llama-70B");
    expect(models).toContain("mistralai/Mixtral-8x22B-Instruct-v0.1");
    expect(models).toContain("Qwen/Qwen2.5-72B-Instruct-Turbo");
  });
});

describe("Together AI error handling", () => {
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
