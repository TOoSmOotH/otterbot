import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ---

const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("../../opencode/opencode-manager.js", () => ({
  ensureOpenCodeConfig: vi.fn(),
  writeOpenCodeConfig: vi.fn(),
}));

vi.mock("../../tools/opencode-client.js", () => ({
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  })),
}));

vi.mock("../../coding-agents/claude-code-manager.js", () => ({
  isClaudeCodeInstalled: vi.fn(() => false),
  isClaudeCodeReady: vi.fn(() => false),
}));

vi.mock("../../coding-agents/codex-manager.js", () => ({
  isCodexInstalled: vi.fn(() => false),
  isCodexReady: vi.fn(() => false),
}));

// Mock DB — getAgentModelOverrides reads from the config table via raw select
const mockConfigRows: Array<{ key: string; value: string }> = [];
vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        all: vi.fn(() => mockConfigRows),
        where: vi.fn(() => ({
          get: vi.fn(() => null),
        })),
      })),
    })),
  })),
  schema: {
    providers: {},
    config: {},
  },
}));

vi.mock("../../llm/adapter.js", () => ({
  resolveModel: vi.fn(),
}));

vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

vi.mock("../../tts/tts.js", () => ({
  getConfiguredTTSProvider: vi.fn(() => null),
}));

vi.mock("../../stt/stt.js", () => ({
  getConfiguredSTTProvider: vi.fn(() => null),
}));

import {
  getAgentModelOverrides,
  getAgentModelOverride,
  setAgentModelOverride,
  clearAgentModelOverride,
} from "../settings.js";

describe("Agent model overrides", () => {
  beforeEach(() => {
    configStore.clear();
    mockConfigRows.length = 0;
  });

  describe("setAgentModelOverride", () => {
    it("stores provider and model in config", () => {
      setAgentModelOverride("builtin-web-search", "anthropic-1", "claude-opus-4-20250514");

      expect(configStore.get("agent_override:builtin-web-search:provider")).toBe("anthropic-1");
      expect(configStore.get("agent_override:builtin-web-search:model")).toBe("claude-opus-4-20250514");
    });

    it("overwrites existing override", () => {
      setAgentModelOverride("builtin-coder", "openai-1", "gpt-4o");
      setAgentModelOverride("builtin-coder", "anthropic-1", "claude-sonnet-4-5-20250929");

      expect(configStore.get("agent_override:builtin-coder:provider")).toBe("anthropic-1");
      expect(configStore.get("agent_override:builtin-coder:model")).toBe("claude-sonnet-4-5-20250929");
    });
  });

  describe("getAgentModelOverride", () => {
    it("returns null when no override is set", () => {
      const result = getAgentModelOverride("builtin-web-search");
      expect(result).toBeNull();
    });

    it("returns null when only provider is set (incomplete override)", () => {
      configStore.set("agent_override:builtin-web-search:provider", "anthropic-1");
      const result = getAgentModelOverride("builtin-web-search");
      expect(result).toBeNull();
    });

    it("returns override when both provider and model are set", () => {
      configStore.set("agent_override:builtin-web-search:provider", "anthropic-1");
      configStore.set("agent_override:builtin-web-search:model", "claude-opus-4-20250514");

      const result = getAgentModelOverride("builtin-web-search");
      expect(result).toEqual({
        registryEntryId: "builtin-web-search",
        provider: "anthropic-1",
        model: "claude-opus-4-20250514",
      });
    });
  });

  describe("clearAgentModelOverride", () => {
    it("removes both provider and model from config", () => {
      configStore.set("agent_override:builtin-coder:provider", "openai-1");
      configStore.set("agent_override:builtin-coder:model", "gpt-4o");

      clearAgentModelOverride("builtin-coder");

      expect(configStore.has("agent_override:builtin-coder:provider")).toBe(false);
      expect(configStore.has("agent_override:builtin-coder:model")).toBe(false);
    });

    it("does not error when clearing non-existent override", () => {
      expect(() => clearAgentModelOverride("non-existent")).not.toThrow();
    });
  });

  describe("getAgentModelOverrides", () => {
    it("returns empty array when no overrides exist", () => {
      const result = getAgentModelOverrides();
      expect(result).toEqual([]);
    });

    it("returns all complete overrides from config rows", () => {
      mockConfigRows.push(
        { key: "agent_override:builtin-web-search:provider", value: "anthropic-1" },
        { key: "agent_override:builtin-web-search:model", value: "claude-opus-4-20250514" },
        { key: "agent_override:builtin-coder:provider", value: "openai-1" },
        { key: "agent_override:builtin-coder:model", value: "gpt-4o" },
      );

      const result = getAgentModelOverrides();
      expect(result).toHaveLength(2);
      expect(result).toContainEqual({
        registryEntryId: "builtin-web-search",
        provider: "anthropic-1",
        model: "claude-opus-4-20250514",
      });
      expect(result).toContainEqual({
        registryEntryId: "builtin-coder",
        provider: "openai-1",
        model: "gpt-4o",
      });
    });

    it("skips incomplete overrides (missing model)", () => {
      mockConfigRows.push(
        { key: "agent_override:builtin-web-search:provider", value: "anthropic-1" },
        // No model for builtin-web-search
        { key: "agent_override:builtin-coder:provider", value: "openai-1" },
        { key: "agent_override:builtin-coder:model", value: "gpt-4o" },
      );

      const result = getAgentModelOverrides();
      expect(result).toHaveLength(1);
      expect(result[0].registryEntryId).toBe("builtin-coder");
    });

    it("ignores non-override config keys", () => {
      mockConfigRows.push(
        { key: "coo_provider", value: "anthropic-1" },
        { key: "coo_model", value: "claude-sonnet-4-5-20250929" },
        { key: "agent_override:builtin-coder:provider", value: "openai-1" },
        { key: "agent_override:builtin-coder:model", value: "gpt-4o" },
      );

      const result = getAgentModelOverrides();
      expect(result).toHaveLength(1);
    });
  });

  describe("round-trip", () => {
    it("set then get returns the override", () => {
      setAgentModelOverride("builtin-web-search", "anthropic-1", "claude-opus-4-20250514");

      const result = getAgentModelOverride("builtin-web-search");
      expect(result).toEqual({
        registryEntryId: "builtin-web-search",
        provider: "anthropic-1",
        model: "claude-opus-4-20250514",
      });
    });

    it("set then clear then get returns null", () => {
      setAgentModelOverride("builtin-web-search", "anthropic-1", "claude-opus-4-20250514");
      clearAgentModelOverride("builtin-web-search");

      const result = getAgentModelOverride("builtin-web-search");
      expect(result).toBeNull();
    });
  });
});
