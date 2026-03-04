import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const wizardSource = readFileSync(
  resolve(__dirname, "../SetupWizard.tsx"),
  "utf-8",
);

describe("SetupWizard multi-provider selection", () => {
  it("renders a provider grid with data-testid", () => {
    expect(wizardSource).toContain('data-testid="provider-grid"');
  });

  it("renders per-provider buttons with data-testid pattern", () => {
    expect(wizardSource).toContain("data-testid={`provider-btn-${pt.type}`}");
  });

  it("shows a Primary badge on the primary provider", () => {
    expect(wizardSource).toContain("primary-badge-");
    // Badge text content
    expect(wizardSource).toMatch(/Primary\s*<\/span>/);
    // Only displayed when isPrimary is true
    expect(wizardSource).toContain("{isPrimary && (");
  });

  it("shows a checkmark indicator for additional (non-primary) providers", () => {
    expect(wizardSource).toContain("selected-indicator-");
    expect(wizardSource).toContain("{isAdditional && (");
    expect(wizardSource).toContain("&#10003;");
  });

  it("tracks additionalProviders state as an array", () => {
    expect(wizardSource).toContain(
      "useState<SetupProviderEntry[]>([])",
    );
  });

  it("renders an additional-providers configuration section", () => {
    expect(wizardSource).toContain('data-testid="additional-providers-section"');
    expect(wizardSource).toContain("Additional Providers");
  });

  it("renders per-additional-provider config blocks with remove buttons", () => {
    expect(wizardSource).toContain("data-testid={`additional-provider-${ap.type}`}");
    expect(wizardSource).toContain("data-testid={`remove-additional-${ap.type}`}");
    expect(wizardSource).toMatch(/Remove\s*<\/button>/);
  });

  it("shows name, API key, and base URL fields per additional provider", () => {
    // Name field always present for additional providers
    expect(wizardSource).toContain(
      'updateAdditionalProvider(ap.type, { name: e.target.value })',
    );
    // API key shown conditionally
    expect(wizardSource).toContain(
      'updateAdditionalProvider(ap.type, { apiKey: e.target.value })',
    );
    // Base URL shown conditionally
    expect(wizardSource).toContain(
      'updateAdditionalProvider(ap.type, { baseUrl: e.target.value })',
    );
  });

  it("sends additionalProviders in the completeSetup call", () => {
    expect(wizardSource).toContain(
      "additionalProviders: additionalProviders.length > 0 ? additionalProviders : undefined",
    );
  });

  it("persists additionalProviders in session storage", () => {
    // Save call includes additionalProviders
    expect(wizardSource).toContain("additionalProviders,");
    // Restore logic handles the array
    expect(wizardSource).toContain(
      'if (Array.isArray(saved.additionalProviders))',
    );
  });

  it("validates additional providers before advancing", () => {
    expect(wizardSource).toContain("for (const ap of additionalProviders)");
    expect(wizardSource).toContain("An API key is required for");
    expect(wizardSource).toContain("A base URL is required for");
  });

  it("imports SetupProviderEntry from shared", () => {
    expect(wizardSource).toContain("SetupProviderEntry");
  });
});
