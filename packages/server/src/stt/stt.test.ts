import { describe, it, expect, vi, beforeEach } from "vitest";

const getConfigMock = vi.fn();
const ensureModelCacheDirMock = vi.fn();
const decodeToFloat32Mock = vi.fn();
const pipelineFactoryMock = vi.fn();

vi.mock("../auth/auth.js", () => ({
  getConfig: getConfigMock,
}));

vi.mock("../utils/model-cache.js", () => ({
  ensureModelCacheDir: ensureModelCacheDirMock,
}));

vi.mock("./audio-utils.js", () => ({
  decodeToFloat32: decodeToFloat32Mock,
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: pipelineFactoryMock,
}));

describe("whisper local provider cache configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("uses ensureModelCacheDir and passes cache_dir to whisper pipeline", async () => {
    getConfigMock.mockImplementation((key: string) => {
      if (key === "stt:active_provider") return "whisper-local";
      if (key === "stt:whisper:model_id") return "onnx-community/whisper-small";
      return null;
    });
    ensureModelCacheDirMock.mockResolvedValue("/tmp/shared-cache");
    decodeToFloat32Mock.mockResolvedValue(new Float32Array([0.25, -0.25]));

    const whisperRunMock = vi.fn().mockResolvedValue({ text: " transcribed text " });
    pipelineFactoryMock.mockResolvedValue(whisperRunMock);

    const { getConfiguredSTTProvider } = await import("./stt.js");
    const provider = getConfiguredSTTProvider();
    expect(provider).not.toBeNull();

    const result = await provider!.transcribe(Buffer.from("audio"));

    expect(ensureModelCacheDirMock).toHaveBeenCalledTimes(1);
    expect(pipelineFactoryMock).toHaveBeenCalledWith(
      "automatic-speech-recognition",
      "onnx-community/whisper-small",
      { dtype: "q8", device: "cpu", cache_dir: "/tmp/shared-cache" },
    );
    expect(result).toEqual({ text: "transcribed text" });
  });
});
