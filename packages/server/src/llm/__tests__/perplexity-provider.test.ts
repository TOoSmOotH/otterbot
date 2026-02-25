import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Perplexity Sonar LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a Perplexity model via OpenAI SDK
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

const mockPerplexityModel = { modelId: "sonar", provider: "perplexity" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockPerplexityModel, modelId: model })),
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

describe("Perplexity provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a Perplexity model via OpenAI SDK with correct base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "perplexity",
        model: "sonar",
        apiKey: "pplx-test-key-123",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.perplexity.ai",
        apiKey: "pplx-test-key-123",
      });
      expect(model).toMatchObject({ modelId: "sonar" });
    });

    it("passes the correct model ID for sonar-pro", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "perplexity",
        model: "sonar-pro",
        apiKey: "pplx-key",
      });

      expect(model).toMatchObject({ modelId: "sonar-pro" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "perplexity",
        model: "sonar",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.perplexity.ai",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "perplexity",
        model: "sonar",
        apiKey: "pplx-key",
        baseUrl: "https://custom-perplexity.example.com",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://custom-perplexity.example.com",
        apiKey: "pplx-key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("perplexity");
      expect(creds.type).toBe("perplexity");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Perplexity models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "perplexity", model: "sonar" })).toBe(false);
      expect(isThinkingModel({ provider: "perplexity", model: "sonar-pro" })).toBe(false);
      expect(isThinkingModel({ provider: "perplexity", model: "sonar-reasoning" })).toBe(false);
    });
  });
});

describe("Perplexity provider configuration", () => {
  it("includes perplexity in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const pplxMeta = PROVIDER_TYPE_META.find((m) => m.type === "perplexity");
    expect(pplxMeta).toBeDefined();
    expect(pplxMeta!.label).toBe("Perplexity Sonar");
    expect(pplxMeta!.needsApiKey).toBe(true);
    expect(pplxMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for perplexity provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("perplexity");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("sonar");
    expect(models).toContain("sonar-pro");
  });
});

describe("Perplexity error handling", () => {
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
