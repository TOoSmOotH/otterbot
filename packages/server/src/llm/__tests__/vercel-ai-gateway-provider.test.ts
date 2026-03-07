import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const mockGatewayModel = { modelId: "openai:gpt-4o", provider: "vercel-ai-gateway" };
const mockGatewayFactory = vi.fn((model: string) => ({ ...mockGatewayModel, modelId: model }));
const mockCreateGateway = vi.fn(() => mockGatewayFactory);

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: mockCreateGateway,
}));

// Mock other imports from adapter.ts
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
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => vi.fn()),
}));

describe("Vercel AI Gateway provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("resolveModel", () => {
    it("creates a gateway model with API key", async () => {
      const { resolveModel } = await import("../adapter.js");

      const model = resolveModel({
        provider: "vercel-ai-gateway",
        model: "openai:gpt-4o",
        apiKey: "vercel_gateway_key",
      });

      expect(mockCreateGateway).toHaveBeenCalledWith({
        apiKey: "vercel_gateway_key",
      });
      expect(model).toMatchObject({ modelId: "openai:gpt-4o" });
    });

    it("uses a custom base URL when provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "vercel-ai-gateway",
        model: "anthropic:claude-sonnet-4-5-20250929",
        apiKey: "vercel_gateway_key",
        baseUrl: "https://gateway-proxy.example.com/v1",
      });

      expect(mockCreateGateway).toHaveBeenCalledWith({
        apiKey: "vercel_gateway_key",
        baseURL: "https://gateway-proxy.example.com/v1",
      });
      expect(mockGatewayFactory).toHaveBeenCalledWith("anthropic:claude-sonnet-4-5-20250929");
    });

    it("uses an empty API key when none is provided", async () => {
      const { resolveModel } = await import("../adapter.js");

      resolveModel({
        provider: "vercel-ai-gateway",
        model: "google:gemini-2.5-flash",
      });

      expect(mockCreateGateway).toHaveBeenCalledWith({
        apiKey: "",
      });
    });
  });

  describe("resolveProviderCredentials", () => {
    it("falls back to legacy config when provider is not in DB", async () => {
      const { resolveProviderCredentials } = await import("../adapter.js");

      const creds = resolveProviderCredentials("vercel-ai-gateway");
      expect(creds.type).toBe("vercel-ai-gateway");
    });
  });
});

describe("Vercel AI Gateway provider configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes vercel-ai-gateway in PROVIDER_TYPE_META", async () => {
    const { PROVIDER_TYPE_META } = await import("../../settings/settings.js");

    const meta = PROVIDER_TYPE_META.find((m) => m.type === "vercel-ai-gateway");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("Vercel AI Gateway");
    expect(meta!.needsApiKey).toBe(true);
    expect(meta!.needsBaseUrl).toBe(false);
  });

  it("returns fallback models when API key is missing", async () => {
    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");

    const models = await fetchModelsWithCredentials("vercel-ai-gateway");
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("openai:gpt-4o");
    expect(models).toContain("google:gemini-2.5-flash");
  });

  it("fetches and sorts models using default gateway URL", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "xai:grok-3" },
          { id: "anthropic:claude-sonnet-4-5-20250929" },
          { id: "openai:gpt-4o" },
        ],
      }),
    }));
    vi.stubGlobal("fetch", mockFetch);

    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");
    const models = await fetchModelsWithCredentials("vercel-ai-gateway", "vercel_gateway_key");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://gateway.ai.vercel.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer vercel_gateway_key" },
      }),
    );
    expect(models).toEqual([
      "anthropic:claude-sonnet-4-5-20250929",
      "openai:gpt-4o",
      "xai:grok-3",
    ]);
  });

  it("uses custom base URL and falls back when API returns non-OK", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
    }));
    vi.stubGlobal("fetch", mockFetch);

    const { fetchModelsWithCredentials } = await import("../../settings/settings.js");
    const models = await fetchModelsWithCredentials(
      "vercel-ai-gateway",
      "vercel_gateway_key",
      "https://custom-gateway.example.com/v1",
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-gateway.example.com/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer vercel_gateway_key" },
      }),
    );
    expect(models).toContain("anthropic:claude-sonnet-4-5-20250929");
    expect(models).toContain("openai:gpt-4o");
  });
});
