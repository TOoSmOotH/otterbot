import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const configStore = new Map<string, string>();

  const customModelsTable = { providerId: Symbol("customModels.providerId") };
  const providersTable = { id: Symbol("providers.id") };

  const runCustomModelsDelete = vi.fn();
  const runProvidersDelete = vi.fn();

  const whereCustomModelsDelete = vi.fn(() => ({ run: runCustomModelsDelete }));
  const whereProvidersDelete = vi.fn(() => ({ run: runProvidersDelete }));

  const dbDelete = vi.fn((table: unknown) => {
    if (table === customModelsTable) {
      return { where: whereCustomModelsDelete };
    }
    if (table === providersTable) {
      return { where: whereProvidersDelete };
    }
    throw new Error("Unexpected table passed to db.delete");
  });

  return {
    configStore,
    customModelsTable,
    providersTable,
    runCustomModelsDelete,
    runProvidersDelete,
    whereCustomModelsDelete,
    whereProvidersDelete,
    dbDelete,
    eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  };
});

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => mocks.configStore.get(key)),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    delete: mocks.dbDelete,
  })),
  schema: {
    providers: mocks.providersTable,
    customModels: mocks.customModelsTable,
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
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

vi.mock("../../tools/opencode-client.js", () => ({
  OpenCodeClient: vi.fn(),
}));

vi.mock("../../opencode/opencode-manager.js", () => ({
  ensureOpenCodeConfig: vi.fn(),
  writeOpenCodeConfig: vi.fn(),
}));

vi.mock("../../coding-agents/claude-code-manager.js", () => ({
  isClaudeCodeInstalled: vi.fn(() => false),
  isClaudeCodeReady: vi.fn(() => false),
}));

vi.mock("../../coding-agents/codex-manager.js", () => ({
  isCodexInstalled: vi.fn(() => false),
  isCodexReady: vi.fn(() => false),
}));

vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id"),
}));

import { deleteProvider } from "../settings.js";

describe("deleteProvider", () => {
  beforeEach(() => {
    mocks.configStore.clear();
    mocks.runCustomModelsDelete.mockClear();
    mocks.runProvidersDelete.mockClear();
    mocks.whereCustomModelsDelete.mockClear();
    mocks.whereProvidersDelete.mockClear();
    mocks.dbDelete.mockClear();
    mocks.eq.mockClear();
  });

  it("returns an error and does not delete when provider is in use as default", () => {
    mocks.configStore.set("coo_provider", "provider-1");

    const result = deleteProvider("provider-1");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Provider is in use as a tier default");
    expect(mocks.dbDelete).not.toHaveBeenCalled();
  });

  it("deletes referencing custom models before deleting provider", () => {
    const result = deleteProvider("provider-2");

    expect(result).toEqual({ ok: true });
    expect(mocks.dbDelete).toHaveBeenCalledTimes(2);
    expect(mocks.dbDelete).toHaveBeenNthCalledWith(1, mocks.customModelsTable);
    expect(mocks.dbDelete).toHaveBeenNthCalledWith(2, mocks.providersTable);

    expect(mocks.eq).toHaveBeenNthCalledWith(1, mocks.customModelsTable.providerId, "provider-2");
    expect(mocks.eq).toHaveBeenNthCalledWith(2, mocks.providersTable.id, "provider-2");

    expect(mocks.runCustomModelsDelete).toHaveBeenCalledTimes(1);
    expect(mocks.runProvidersDelete).toHaveBeenCalledTimes(1);
  });
});
