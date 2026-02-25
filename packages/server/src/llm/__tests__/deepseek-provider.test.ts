import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the DeepSeek LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a DeepSeek language model via OpenAI SDK
 * - Provider credentials are resolved properly (Bearer token auth)
 * - Configuration (provider type metadata, fallback models) is correct
 * - Model selection passes through the correct model IDs
 * - Model discovery and error handling work correctly
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

const mockDeepSeekModel = { modelId: "deepseek-chat", provider: "deepseek" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockDeepSeekModel, modelId: model })),
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
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => vi.fn()),
}));

describe("DeepSeek provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a DeepSeek model via OpenAI SDK with correct base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-deepseek-test-key",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-deepseek-test-key",
      });
      expect(model).toMatchObject({ modelId: "deepseek-chat" });
    });

    it("passes the correct model ID for deepseek-reasoner", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "sk-key",
      });

      expect(model).toMatchObject({ modelId: "deepseek-reasoner" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "deepseek",
        model: "deepseek-chat",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.deepseek.com",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-key",
        baseUrl: "https://custom-deepseek.example.com/v1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://custom-deepseek.example.com/v1",
        apiKey: "sk-key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("deepseek");
      expect(creds.type).toBe("deepseek");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for DeepSeek models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "deepseek", model: "deepseek-chat" })).toBe(false);
      expect(isThinkingModel({ provider: "deepseek", model: "deepseek-reasoner" })).toBe(false);
    });
  });
});

describe("DeepSeek provider configuration", () => {
  it("includes deepseek in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const dsMeta = PROVIDER_TYPE_META.find((m) => m.type === "deepseek");
    expect(dsMeta).toBeDefined();
    expect(dsMeta!.label).toBe("DeepSeek");
    expect(dsMeta!.needsApiKey).toBe(true);
    expect(dsMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for deepseek provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("deepseek");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("deepseek-chat");
    expect(models).toContain("deepseek-reasoner");
  });
});

describe("DeepSeek model pricing", () => {
  it("has pricing configured for deepseek-chat", async () => {
    const { getModelPrice } = await import("../../settings/model-pricing.js");

    const price = getModelPrice("deepseek-chat");
    expect(price.inputPerMillion).toBeGreaterThan(0);
    expect(price.outputPerMillion).toBeGreaterThan(0);
  });

  it("has pricing configured for deepseek-reasoner", async () => {
    const { getModelPrice } = await import("../../settings/model-pricing.js");

    const price = getModelPrice("deepseek-reasoner");
    expect(price.inputPerMillion).toBeGreaterThan(0);
    expect(price.outputPerMillion).toBeGreaterThan(0);
  });
});

describe("DeepSeek error handling", () => {
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
