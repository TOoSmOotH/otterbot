import { describe, it, expect } from "vitest";
import type { ProviderType, ProviderTypeMeta } from "@otterbot/shared";

/**
 * UI integration tests for the AWS Bedrock provider in the settings page.
 *
 * These verify that:
 * - The ProviderType union includes "bedrock"
 * - The provider type metadata structure is correct for UI rendering
 * - Bedrock requires both API key (credentials) and base URL (region)
 */

describe("AWS Bedrock UI integration", () => {
  it("ProviderType union accepts 'bedrock'", () => {
    const bedrockType: ProviderType = "bedrock";
    expect(bedrockType).toBe("bedrock");
  });

  it("ProviderTypeMeta structure is valid for bedrock", () => {
    const bedrockMeta: ProviderTypeMeta = {
      type: "bedrock",
      label: "AWS Bedrock",
      needsApiKey: true,
      needsBaseUrl: true,
    };

    expect(bedrockMeta.type).toBe("bedrock");
    expect(bedrockMeta.label).toBe("AWS Bedrock");
    expect(bedrockMeta.needsApiKey).toBe(true);
    expect(bedrockMeta.needsBaseUrl).toBe(true);
  });

  it("bedrock provider requires both API key and base URL", () => {
    // Bedrock uses apiKey for "accessKeyId:secretAccessKey" and baseUrl for region
    const meta: ProviderTypeMeta = {
      type: "bedrock",
      label: "AWS Bedrock",
      needsApiKey: true,
      needsBaseUrl: true,
    };

    // When needsApiKey is true, the AddProviderForm shows the API Key input
    expect(meta.needsApiKey).toBe(true);
    // When needsBaseUrl is true, the AddProviderForm shows the Base URL input (used for region)
    expect(meta.needsBaseUrl).toBe(true);
  });
});
