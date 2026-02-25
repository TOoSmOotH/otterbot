import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the MiniMax LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates a MiniMax language model via OpenAI SDK
 * - Provider credentials are resolved properly
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

const mockMinimaxModel = { modelId: "MiniMax-M1", provider: "minimax" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockMinimaxModel, modelId: model })),
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

describe("MiniMax provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates a MiniMax model via OpenAI SDK with correct base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "minimax",
        model: "MiniMax-M1",
        apiKey: "minimax_test_key_123",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.chat/v1",
        apiKey: "minimax_test_key_123",
      });
      expect(model).toMatchObject({ modelId: "MiniMax-M1" });
    });

    it("passes the correct model ID for different MiniMax models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "minimax",
        model: "MiniMax-Text-01",
        apiKey: "minimax_key",
      });

      expect(model).toMatchObject({ modelId: "MiniMax-Text-01" });
    });

    it("uses an empty string when no API key is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "minimax",
        model: "MiniMax-M1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://api.minimax.chat/v1",
        apiKey: "",
      });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "minimax",
        model: "MiniMax-M1",
        apiKey: "minimax_key",
        baseUrl: "https://custom-minimax.example.com/v1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "https://custom-minimax.example.com/v1",
        apiKey: "minimax_key",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("minimax");
      expect(creds.type).toBe("minimax");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for MiniMax models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "minimax", model: "MiniMax-M1" })).toBe(false);
      expect(isThinkingModel({ provider: "minimax", model: "MiniMax-Text-01" })).toBe(false);
    });
  });
});

describe("MiniMax provider configuration", () => {
  it("includes minimax in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const meta = PROVIDER_TYPE_META.find((m) => m.type === "minimax");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("MiniMax");
    expect(meta!.needsApiKey).toBe(true);
    expect(meta!.needsBaseUrl).toBe(false);
  });

  it("has fallback models for minimax provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("minimax");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("MiniMax-M1");
    expect(models).toContain("MiniMax-Text-01");
  });
});
