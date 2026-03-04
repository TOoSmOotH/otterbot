import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mkdirSyncMock = vi.fn();
const transformersEnv = { cacheDir: "" };

vi.mock("node:fs", () => ({
  mkdirSync: mkdirSyncMock,
}));

vi.mock("@huggingface/transformers", () => ({
  env: transformersEnv,
}));

describe("model cache utils", () => {
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalHFHome = process.env.HF_HOME;
  const originalTransformersCache = process.env.TRANSFORMERS_CACHE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    transformersEnv.cacheDir = "";
    delete process.env.HF_HOME;
    delete process.env.TRANSFORMERS_CACHE;
  });

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = originalWorkspaceRoot;
    }

    if (originalHFHome === undefined) {
      delete process.env.HF_HOME;
    } else {
      process.env.HF_HOME = originalHFHome;
    }

    if (originalTransformersCache === undefined) {
      delete process.env.TRANSFORMERS_CACHE;
    } else {
      process.env.TRANSFORMERS_CACHE = originalTransformersCache;
    }
  });

  it("uses WORKSPACE_ROOT when resolving cache dir", async () => {
    process.env.WORKSPACE_ROOT = "/tmp/otterbot-workspace";
    const { getModelCacheDir } = await import("./model-cache.js");

    expect(getModelCacheDir()).toBe("/tmp/otterbot-workspace/data/models");
  });

  it("falls back to docker/otterbot path when WORKSPACE_ROOT is not set", async () => {
    delete process.env.WORKSPACE_ROOT;
    const { getModelCacheDir } = await import("./model-cache.js");

    expect(getModelCacheDir()).toMatch(/docker[\\/]otterbot[\\/]data[\\/]models$/);
  });

  it("creates and configures shared model cache directory", async () => {
    process.env.WORKSPACE_ROOT = "/tmp/hf-cache";
    const { ensureModelCacheDir } = await import("./model-cache.js");

    const cacheDir = await ensureModelCacheDir();

    expect(cacheDir).toBe("/tmp/hf-cache/data/models");
    expect(mkdirSyncMock).toHaveBeenCalledWith("/tmp/hf-cache/data/models", { recursive: true });
    expect(transformersEnv.cacheDir).toBe("/tmp/hf-cache/data/models");
    expect(process.env.HF_HOME).toBe("/tmp/hf-cache/data/models");
    expect(process.env.TRANSFORMERS_CACHE).toBe("/tmp/hf-cache/data/models");
  });

  it("continues configuring cache when mkdirSync throws", async () => {
    process.env.WORKSPACE_ROOT = "/tmp/hf-cache-throw";
    mkdirSyncMock.mockImplementationOnce(() => {
      throw new Error("read-only");
    });

    const { ensureModelCacheDir } = await import("./model-cache.js");
    const cacheDir = await ensureModelCacheDir();

    expect(cacheDir).toBe("/tmp/hf-cache-throw/data/models");
    expect(transformersEnv.cacheDir).toBe("/tmp/hf-cache-throw/data/models");
    expect(process.env.HF_HOME).toBe("/tmp/hf-cache-throw/data/models");
    expect(process.env.TRANSFORMERS_CACHE).toBe("/tmp/hf-cache-throw/data/models");
  });
});
