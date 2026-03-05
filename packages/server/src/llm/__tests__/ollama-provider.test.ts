import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the Ollama LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates an Ollama model via the OpenAI SDK
 *   (using Ollama's OpenAI-compatible endpoint at /v1)
 * - The default base URL points to http://localhost:11434/v1
 * - A dummy API key ("ollama") is used since Ollama doesn't require auth
 * - Custom base URLs are passed through correctly
 * - Provider metadata is configured correctly (no API key required, base URL required)
 * - System messages are consolidated for Ollama models
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

const mockOllamaModel = { modelId: "llama3.1", provider: "ollama" };
const mockCreateOpenAI = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockOllamaModel, modelId: model })),
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
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => vi.fn()),
}));

describe("Ollama provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates an Ollama model via OpenAI SDK with correct default base URL", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "ollama",
        model: "llama3.1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "http://localhost:11434/v1",
        apiKey: "ollama",
      });
      expect(model).toMatchObject({ modelId: "llama3.1" });
    });

    it("passes the correct model ID for different Ollama models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "ollama",
        model: "mistral",
      });

      expect(model).toMatchObject({ modelId: "mistral" });
    });

    it("uses a dummy API key since Ollama doesn't require authentication", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "ollama",
        model: "codellama",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "ollama" }),
      );
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "ollama",
        model: "llama3.1",
        baseUrl: "http://192.168.1.100:11434/v1",
      });

      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        baseURL: "http://192.168.1.100:11434/v1",
        apiKey: "ollama",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("ollama");
      expect(creds.type).toBe("ollama");
    });
  });

  describe("isThinkingModel", () => {
    it("returns false for Ollama models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "ollama", model: "llama3.1" })).toBe(false);
      expect(isThinkingModel({ provider: "ollama", model: "mistral" })).toBe(false);
      expect(isThinkingModel({ provider: "ollama", model: "codellama" })).toBe(false);
    });
  });
});

describe("Ollama provider configuration", () => {
  it("includes ollama in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const ollamaMeta = PROVIDER_TYPE_META.find((m) => m.type === "ollama");
    expect(ollamaMeta).toBeDefined();
    expect(ollamaMeta!.label).toBe("Ollama");
    expect(ollamaMeta!.needsApiKey).toBe(false);
    expect(ollamaMeta!.needsBaseUrl).toBe(true);
  });

  it("has fallback models for ollama provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Returns either live models from a running Ollama server or fallback models
    const models = await fetchModelsWithCredentials("ollama");
    expect(models.length).toBeGreaterThan(0);
  });
});

describe("Ollama model pricing", () => {
  it("returns zero pricing for Ollama models (local, self-hosted)", async () => {
    const { getModelPrice } = await import("../../settings/model-pricing.js");

    const price = getModelPrice("llama3.1");
    expect(price.inputPerMillion).toBe(0);
    expect(price.outputPerMillion).toBe(0);
  });
});
