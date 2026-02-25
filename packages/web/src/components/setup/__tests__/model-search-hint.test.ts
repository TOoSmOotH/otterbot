import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests that the SetupWizard model selection step includes an accessible
 * search hint note so users know the input box supports searching/filtering.
 */
const wizardSource = readFileSync(
  resolve(__dirname, "../SetupWizard.tsx"),
  "utf-8",
);

describe("SetupWizard model search hint", () => {
  it("includes a visible hint note for the model search box", () => {
    expect(wizardSource).toContain('data-testid="model-search-hint"');
    expect(wizardSource).toContain(
      "Type to search and filter available models, or enter a custom model name.",
    );
  });

  it("links the hint to the input via aria-describedby for accessibility", () => {
    expect(wizardSource).toContain('aria-describedby="model-search-hint"');
    expect(wizardSource).toContain('id="model-search-hint"');
  });

  it("includes hints for both LLM and coding-agent model steps", () => {
    expect(wizardSource).toContain('id="model-search-hint"');
    expect(wizardSource).toContain('id="opencode-model-search-hint"');
    expect(wizardSource).toContain('aria-describedby="opencode-model-search-hint"');
  });
});
