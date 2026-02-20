import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ---

const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock opencode-manager (imported by settings.ts)
vi.mock("../../opencode/opencode-manager.js", () => ({
  startOpenCodeServer: vi.fn(),
  stopOpenCodeServer: vi.fn(),
}));

// Mock opencode-client
vi.mock("../../tools/opencode-client.js", () => ({
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  })),
}));

// Mock coding-agent managers
vi.mock("../../coding-agents/claude-code-manager.js", () => ({
  isClaudeCodeInstalled: vi.fn(() => false),
  isClaudeCodeReady: vi.fn(() => false),
}));
vi.mock("../../coding-agents/codex-manager.js", () => ({
  isCodexInstalled: vi.fn(() => false),
  isCodexReady: vi.fn(() => false),
}));

// Mock DB (needed by getProviderRow in updateOpenCodeSettings)
vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => null),
        })),
      })),
    })),
  })),
  schema: { providers: {} },
}));

// Mock LLM adapter
vi.mock("../../llm/adapter.js", () => ({
  resolveModel: vi.fn(),
}));

// Mock search providers
vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

// Mock TTS
vi.mock("../../tts/tts.js", () => ({
  getConfiguredTTSProvider: vi.fn(() => null),
}));

// Mock STT
vi.mock("../../stt/stt.js", () => ({
  getConfiguredSTTProvider: vi.fn(() => null),
}));

import {
  getClaudeCodeSettings,
  updateClaudeCodeSettings,
  getCodexSettings,
  updateCodexSettings,
} from "../settings.js";

describe("Coding agent settings", () => {
  beforeEach(() => {
    configStore.clear();
  });

  // ─── Claude Code ──────────────────────────────────────────

  describe("Claude Code settings", () => {
    it("getClaudeCodeSettings returns defaults when no config set", () => {
      const settings = getClaudeCodeSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.authMode).toBe("api-key");
      expect(settings.apiKeySet).toBe(false);
      expect(settings.model).toBe("claude-sonnet-4-5-20250929");
      expect(settings.approvalMode).toBe("full-auto");
      expect(settings.timeoutMs).toBe(1200000);
      expect(settings.maxTurns).toBe(50);
    });

    it("updateClaudeCodeSettings persists values", async () => {
      await updateClaudeCodeSettings({
        enabled: true,
        apiKey: "sk-test-123",
        model: "claude-opus-4-20250514",
        approvalMode: "auto-edit",
        timeoutMs: 600000,
        maxTurns: 25,
      });

      const settings = getClaudeCodeSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.apiKeySet).toBe(true);
      expect(settings.model).toBe("claude-opus-4-20250514");
      expect(settings.approvalMode).toBe("auto-edit");
      expect(settings.timeoutMs).toBe(600000);
      expect(settings.maxTurns).toBe(25);
    });

    it("updateClaudeCodeSettings with enabled=false deletes api_key", async () => {
      configStore.set("claude-code:api_key", "sk-test-123");
      configStore.set("claude-code:enabled", "true");

      await updateClaudeCodeSettings({ enabled: false, apiKey: "" });

      const settings = getClaudeCodeSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.apiKeySet).toBe(false);
    });
  });

  // ─── Codex ────────────────────────────────────────────────

  describe("Codex settings", () => {
    it("getCodexSettings returns defaults when no config set", () => {
      const settings = getCodexSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.authMode).toBe("api-key");
      expect(settings.apiKeySet).toBe(false);
      expect(settings.model).toBe("codex-mini");
      expect(settings.approvalMode).toBe("full-auto");
      expect(settings.timeoutMs).toBe(1200000);
    });

    it("updateCodexSettings persists values", async () => {
      await updateCodexSettings({
        enabled: true,
        apiKey: "sk-codex-456",
        model: "codex-large",
        approvalMode: "suggest",
        timeoutMs: 300000,
      });

      const settings = getCodexSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.apiKeySet).toBe(true);
      expect(settings.model).toBe("codex-large");
      expect(settings.approvalMode).toBe("suggest");
      expect(settings.timeoutMs).toBe(300000);
    });

    it("updateCodexSettings with enabled=false deletes api_key", async () => {
      configStore.set("codex:api_key", "sk-codex-456");
      configStore.set("codex:enabled", "true");

      await updateCodexSettings({ enabled: false, apiKey: "" });

      const settings = getCodexSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.apiKeySet).toBe(false);
    });
  });
});
