import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Z.AI LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a Z.AI language model via OpenAI SDK
 * - Provider credentials are resolved properly (Bearer token auth)
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

const mockZaiModel = { modelId: "glm-5", provider: "zai" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockZaiModel, modelId: model })),
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

describe("Z.AI provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a Z.AI model via OpenAI SDK with correct base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "zai",
        model: "glm-5",
        apiKey: "zai_test_key_123",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.z.ai/api/paas/v4",
        apiKey: "zai_test_key_123",
      });
      expect(model).toMatchObject({ modelId: "glm-5" });
    });

    it("passes the correct model ID for different Z.AI models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "zai",
        model: "glm-4.7",
        apiKey: "zai_key",
      });

      expect(model).toMatchObject({ modelId: "glm-4.7" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "zai",
        model: "glm-5",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.z.ai/api/paas/v4",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "zai",
        model: "glm-5",
        apiKey: "zai_key",
        baseUrl: "https://custom-zai.example.com/v4",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://custom-zai.example.com/v4",
        apiKey: "zai_key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("zai");
      expect(creds.type).toBe("zai");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Z.AI models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "zai", model: "glm-5" })).toBe(false);
      expect(isThinkingModel({ provider: "zai", model: "glm-4.7" })).toBe(false);
    });
  });
});

describe("Z.AI provider configuration", () => {
  it("includes zai in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const zaiMeta = PROVIDER_TYPE_META.find((m) => m.type === "zai");
    expect(zaiMeta).toBeDefined();
    expect(zaiMeta!.label).toBe("Z.AI");
    expect(zaiMeta!.needsApiKey).toBe(true);
    expect(zaiMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for zai provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("zai");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("glm-5");
    expect(models).toContain("glm-4.7");
  });
});
