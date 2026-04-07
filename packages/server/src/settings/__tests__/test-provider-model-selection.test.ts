import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configStore,
  providerRowRef,
  schemaMock,
  resolveModelMock,
  generateTextMock,
} = vi.hoisted(() => ({
  configStore: new Map<string, string>(),
  providerRowRef: {
    row: null as
      | {
          id: string;
          type: string;
          apiKey?: string | null;
          baseUrl?: string | null;
        }
      | null,
  },
  schemaMock: {
    providers: {},
    customModels: {},
    config: {},
  },
  resolveModelMock: vi.fn((cfg: unknown) => cfg),
  generateTextMock: vi.fn(async () => ({ text: "OK" })),
}));

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === schemaMock.providers) {
          return {
            where: vi.fn(() => ({
              get: vi.fn(() => providerRowRef.row),
            })),
            all: vi.fn(() => (providerRowRef.row ? [providerRowRef.row] : [])),
          };
        }

        if (table === schemaMock.customModels) {
          return {
            where: vi.fn(() => ({
              all: vi.fn(() => []),
            })),
            all: vi.fn(() => []),
          };
        }

        return {
          where: vi.fn(() => ({
            get: vi.fn(() => null),
            all: vi.fn(() => []),
          })),
          all: vi.fn(() => []),
        };
      }),
    })),
  })),
  schema: schemaMock,
}));

vi.mock("../../llm/adapter.js", () => ({
  resolveModel: resolveModelMock,
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("../../opencode/opencode-manager.js", () => ({
  ensureOpenCodeConfig: vi.fn(),
}));

vi.mock("../../tools/opencode-client.js", () => ({
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
  })),
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

import { testProvider } from "../settings.js";

describe("testProvider model selection", () => {
  beforeEach(() => {
    configStore.clear();
    providerRowRef.row = {
      id: "provider-1",
      type: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "https://example.test",
    };

    resolveModelMock.mockClear();
    generateTextMock.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "z-model" }, { id: "a-model" }] }),
      })),
    );
  });

  it("uses an explicit model argument when provided", async () => {
    await testProvider("provider-1", "explicit-model");

    expect(resolveModelMock).toHaveBeenCalledWith({
      provider: "provider-1",
      model: "explicit-model",
    });
  });

  it("uses a configured role model for the matching provider", async () => {
    configStore.set("coo_provider", "provider-1");
    configStore.set("coo_model", "coo-model");

    await testProvider("provider-1");

    expect(resolveModelMock).toHaveBeenCalledWith({
      provider: "provider-1",
      model: "coo-model",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("continues role lookup when an earlier matching role has no model", async () => {
    configStore.set("coo_provider", "provider-1");
    configStore.set("team_lead_provider", "provider-1");
    configStore.set("team_lead_model", "team-model");

    await testProvider("provider-1");

    expect(resolveModelMock).toHaveBeenCalledWith({
      provider: "provider-1",
      model: "team-model",
    });
  });

  it("uses a discovered model for openai-compatible providers when no model is configured", async () => {
    await testProvider("provider-1");

    expect(resolveModelMock).toHaveBeenCalledWith({
      provider: "provider-1",
      model: "a-model",
    });
  });

  it("falls back to 'test' when no configured or discovered model is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );

    await testProvider("provider-1");

    expect(resolveModelMock).toHaveBeenCalledWith({
      provider: "provider-1",
      model: "test",
    });
  });
});
