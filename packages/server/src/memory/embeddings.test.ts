import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureModelCacheDirMock = vi.fn();
const createPipelineMock = vi.fn();

vi.mock("../utils/model-cache.js", () => ({
  ensureModelCacheDir: ensureModelCacheDirMock,
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: createPipelineMock,
}));

describe("embeddings cache configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("passes shared cache_dir to transformers pipeline", async () => {
    ensureModelCacheDirMock.mockResolvedValue("/tmp/shared-model-cache");
    const pipelineMock = vi.fn().mockResolvedValue({ data: [0.1, 0.2, 0.3] });
    createPipelineMock.mockResolvedValue(pipelineMock);

    const { embed } = await import("./embeddings.js");
    const result = await embed("hello world");

    expect(ensureModelCacheDirMock).toHaveBeenCalledTimes(1);
    expect(createPipelineMock).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "fp32", cache_dir: "/tmp/shared-model-cache" },
    );
    expect(pipelineMock).toHaveBeenCalledWith("hello world", { pooling: "mean", normalize: true });
    expect(result).toEqual(new Float32Array([0.1, 0.2, 0.3]));
  });
});
