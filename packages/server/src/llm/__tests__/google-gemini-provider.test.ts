import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Google Gemini LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a Google Gemini language model
 * - Provider credentials are resolved properly
 * - Configuration (provider type metadata, fallback models) is correct
 * - Error handling works for unknown/misconfigured providers
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

const mockGoogleModel = { modelId: "gemini-2.5-flash", provider: "google" };
const mockCreateGoogleGenerativeAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockGoogleModel, modelId: model })),
);

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: mockCreateGoogleGenerativeAI,
}));

// Also mock other providers that are imported at module level
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn()),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => vi.fn()),
}));

describe("Google Gemini provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a Google Gemini model when provider type is 'google'", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-api-key",
      });

      expect(mockCreateGoogleGenerativeAI).toHaveBeenCalledWith({
        apiKey: "test-api-key",
      });
      expect(model).toMatchObject({ modelId: "gemini-2.5-flash" });
    });

    it("passes the correct model ID for different Gemini models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "google",
        model: "gemini-2.5-pro",
        apiKey: "test-key",
      });

      expect(model).toMatchObject({ modelId: "gemini-2.5-pro" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "google",
        model: "gemini-2.0-flash",
      });

      expect(mockCreateGoogleGenerativeAI).toHaveBeenCalledWith({
        apiKey: "",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("google");
      expect(creds.type).toBe("google");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Google Gemini models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "google", model: "gemini-2.5-flash" })).toBe(false);
      expect(isThinkingModel({ provider: "google", model: "gemini-2.5-pro" })).toBe(false);
    });
  });
});

describe("Google Gemini provider configuration", () => {
  it("includes google in PROVIDER_TYPE_META", async () => {
    // Import dynamically to get the mocked version
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const googleMeta = PROVIDER_TYPE_META.find((m) => m.type === "google");
    expect(googleMeta).toBeDefined();
    expect(googleMeta!.label).toBe("Google Gemini");
    expect(googleMeta!.needsApiKey).toBe(true);
    expect(googleMeta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for google provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("google");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("gemini-2.5-flash");
    expect(models).toContain("gemini-2.5-pro");
  });
});

describe("Google Gemini error handling", () => {
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
