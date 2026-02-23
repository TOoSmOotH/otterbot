import { describe, it, expect } from "vitest";
import {
  SUGGESTED_MODELS,
  CODING_SUGGESTED_MODELS,
  NEEDS_API_KEY,
  NEEDS_BASE_URL,
  MODEL_SEARCH_HINT,
  filterModels,
  getDefaultModel,
} from "./setup-wizard-utils";

describe("setup-wizard-utils", () => {
  describe("MODEL_SEARCH_HINT", () => {
    it("contains guidance about searching models", () => {
      expect(MODEL_SEARCH_HINT).toContain("search");
    });

    it("mentions entering a custom model name", () => {
      expect(MODEL_SEARCH_HINT).toContain("custom model name");
    });
  });

  describe("filterModels", () => {
    const models = [
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-20250414",
      "gpt-4o",
      "gpt-4o-mini",
      "llama3.1",
    ];

    it("returns all models when filter is empty", () => {
      expect(filterModels(models, "")).toEqual(models);
    });

    it("filters models by case-insensitive substring", () => {
      expect(filterModels(models, "claude")).toEqual([
        "claude-sonnet-4-5-20250929",
        "claude-haiku-4-20250414",
      ]);
    });

    it("is case-insensitive", () => {
      expect(filterModels(models, "GPT")).toEqual(["gpt-4o", "gpt-4o-mini"]);
    });

    it("returns empty array when nothing matches", () => {
      expect(filterModels(models, "nonexistent")).toEqual([]);
    });

    it("matches partial substrings", () => {
      expect(filterModels(models, "mini")).toEqual(["gpt-4o-mini"]);
    });
  });

  describe("getDefaultModel", () => {
    it("returns the first suggested model for known providers", () => {
      expect(getDefaultModel("anthropic")).toBe("claude-sonnet-4-5-20250929");
      expect(getDefaultModel("openai")).toBe("gpt-4o");
      expect(getDefaultModel("ollama")).toBe("llama3.1");
    });

    it("returns empty string for providers with no suggestions", () => {
      expect(getDefaultModel("openai-compatible")).toBe("");
    });

    it("returns empty string for unknown providers", () => {
      expect(getDefaultModel("unknown-provider")).toBe("");
    });

    it("uses custom suggestions map when provided", () => {
      expect(getDefaultModel("anthropic", CODING_SUGGESTED_MODELS)).toBe(
        "claude-sonnet-4-5-20250929",
      );
      expect(getDefaultModel("openai", CODING_SUGGESTED_MODELS)).toBe("gpt-4.1");
    });
  });

  describe("SUGGESTED_MODELS", () => {
    it("has entries for all standard providers", () => {
      expect(Object.keys(SUGGESTED_MODELS)).toEqual(
        expect.arrayContaining(["anthropic", "openai", "ollama", "openrouter", "openai-compatible"]),
      );
    });
  });

  describe("CODING_SUGGESTED_MODELS", () => {
    it("has entries for all standard providers", () => {
      expect(Object.keys(CODING_SUGGESTED_MODELS)).toEqual(
        expect.arrayContaining(["anthropic", "openai", "ollama", "openrouter", "openai-compatible"]),
      );
    });
  });

  describe("NEEDS_API_KEY", () => {
    it("requires API keys for anthropic, openai, openrouter, and openai-compatible", () => {
      expect(NEEDS_API_KEY.has("anthropic")).toBe(true);
      expect(NEEDS_API_KEY.has("openai")).toBe(true);
      expect(NEEDS_API_KEY.has("openrouter")).toBe(true);
      expect(NEEDS_API_KEY.has("openai-compatible")).toBe(true);
    });

    it("does not require API key for ollama", () => {
      expect(NEEDS_API_KEY.has("ollama")).toBe(false);
    });
  });

  describe("NEEDS_BASE_URL", () => {
    it("requires base URL for ollama and openai-compatible", () => {
      expect(NEEDS_BASE_URL.has("ollama")).toBe(true);
      expect(NEEDS_BASE_URL.has("openai-compatible")).toBe(true);
    });

    it("does not require base URL for anthropic or openai", () => {
      expect(NEEDS_BASE_URL.has("anthropic")).toBe(false);
      expect(NEEDS_BASE_URL.has("openai")).toBe(false);
    });
  });
});
