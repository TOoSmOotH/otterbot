import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the AWS Bedrock LLM provider integration.
 *
 * These tests verify that:
 * - resolveModel correctly creates an Amazon Bedrock language model
 * - Provider credentials are resolved properly (access key + secret key via apiKey, region via baseUrl)
 * - Configuration (provider type metadata, fallback models) is correct
 * - Thinking model detection works for Bedrock-hosted Claude models
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

const mockBedrockModel = { modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0", provider: "bedrock" };
const mockCreateAmazonBedrock = vi.fn(() =>
  vi.fn((model: string) => ({ ...mockBedrockModel, modelId: model })),
);

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: mockCreateAmazonBedrock,
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
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));
vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn(() => vi.fn()),
}));

describe("AWS Bedrock provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    it("creates an Amazon Bedrock model with access key and secret key", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "bedrock",
        model: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        apiKey: "AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        baseUrl: "us-west-2",
      });

      expect(mockCreateAmazonBedrock).toHaveBeenCalledWith({
        region: "us-west-2",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      });
      expect(model).toMatchObject({ modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0" });
    });

    it("passes the correct model ID for different Bedrock models", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "bedrock",
        model: "meta.llama3-1-70b-instruct-v1:0",
        apiKey: "AKID:SECRET",
        baseUrl: "us-east-1",
      });

      expect(model).toMatchObject({ modelId: "meta.llama3-1-70b-instruct-v1:0" });
    });

    it("defaults to us-east-1 region when no baseUrl is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "bedrock",
        model: "anthropic.claude-haiku-4-20250414-v1:0",
        apiKey: "AKID:SECRET",
      });

      expect(mockCreateAmazonBedrock).toHaveBeenCalledWith(
        expect.objectContaining({ region: "us-east-1" }),
      );
    });

    it("handles empty API key gracefully", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "bedrock",
        model: "anthropic.claude-haiku-4-20250414-v1:0",
      });

      expect(mockCreateAmazonBedrock).toHaveBeenCalledWith({
        region: "us-east-1",
        accessKeyId: "",
        secretAccessKey: "",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("bedrock");
      expect(creds.type).toBe("bedrock");
    });
  });

  describe("isThinkingModel", () => {
    it("returns true for Bedrock-hosted Claude thinking models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "bedrock", model: "anthropic.claude-sonnet-4-5-20250929-v1:0" })).toBe(true);
      expect(isThinkingModel({ provider: "bedrock", model: "anthropic.claude-opus-4-20250514-v1:0" })).toBe(true);
    });

    it("returns false for non-thinking Bedrock models", async () => {
      const { isThinkingModel } = await import("../adapter.js");

      expect(isThinkingModel({ provider: "bedrock", model: "anthropic.claude-haiku-4-20250414-v1:0" })).toBe(false);
      expect(isThinkingModel({ provider: "bedrock", model: "meta.llama3-1-70b-instruct-v1:0" })).toBe(false);
      expect(isThinkingModel({ provider: "bedrock", model: "amazon.titan-text-premier-v2:0" })).toBe(false);
    });
  });
});

describe("AWS Bedrock provider configuration", () => {
  it("includes bedrock in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const bedrockMeta = PROVIDER_TYPE_META.find((m) => m.type === "bedrock");
    expect(bedrockMeta).toBeDefined();
    expect(bedrockMeta!.label).toBe("AWS Bedrock");
    expect(bedrockMeta!.needsApiKey).toBe(true);
    expect(bedrockMeta!.needsBaseUrl).toBe(true);
  });

  it("has fallback models for bedrock provider", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    // Without an API key, should return fallback models
    const models = await fetchModelsWithCredentials("bedrock");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(models).toContain("anthropic.claude-haiku-4-20250414-v1:0");
    expect(models).toContain("meta.llama3-1-70b-instruct-v1:0");
    expect(models).toContain("amazon.titan-text-premier-v2:0");
  });
});

describe("AWS Bedrock error handling", () => {
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
