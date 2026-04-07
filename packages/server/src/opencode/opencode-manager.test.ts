import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { homeDirRef } = vi.hoisted(() => ({
  homeDirRef: { value: "" },
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => homeDirRef.value),
  };
});

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn(),
}));

vi.mock("../settings/settings.js", () => ({
  getProviderRow: vi.fn(),
}));

import { writeOpenCodeConfig } from "./opencode-manager.js";

function readWrittenConfig(homeDir: string): Record<string, unknown> {
  const configPath = join(homeDir, ".config", "opencode", "opencode.json");
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
}

describe("writeOpenCodeConfig", () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "opencode-config-test-"));
    homeDirRef.value = tempHome;
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("registers openai-compatible custom models with the same prefixed key used by model", () => {
    writeOpenCodeConfig({
      providerType: "openai-compatible",
      model: "Qwen3-Coder-Next",
      apiKey: "test-key",
    });

    const config = readWrittenConfig(tempHome);
    expect(config.model).toBe("custom/Qwen3-Coder-Next");

    const provider = (config.provider as Record<string, unknown>).custom as Record<string, unknown>;
    expect(provider.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider.models).toEqual({
      "custom/Qwen3-Coder-Next": {},
    });
  });

  it("treats openai with custom base URL as custom provider and prefixes the model key", () => {
    writeOpenCodeConfig({
      providerType: "openai",
      model: "my-local-model",
      baseUrl: "http://localhost:1234/v1",
    });

    const config = readWrittenConfig(tempHome);
    expect(config.model).toBe("custom/my-local-model");

    const provider = (config.provider as Record<string, unknown>).custom as Record<string, unknown>;
    expect(provider.models).toEqual({
      "custom/my-local-model": {},
    });
  });
});
