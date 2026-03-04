import { describe, it, expect, vi, beforeEach } from "vitest";

const getConfigMock = vi.fn();
const ensureModelCacheDirMock = vi.fn();
const fromPretrainedMock = vi.fn();

vi.mock("../auth/auth.js", () => ({
  getConfig: getConfigMock,
}));

vi.mock("../utils/model-cache.js", () => ({
  ensureModelCacheDir: ensureModelCacheDirMock,
}));

vi.mock("kokoro-js", () => ({
  KokoroTTS: {
    from_pretrained: fromPretrainedMock,
  },
}));

describe("kokoro provider cache configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("ensures writable cache before loading Kokoro model", async () => {
    getConfigMock.mockImplementation((key: string) => {
      if (key === "tts:active_provider") return "kokoro";
      return null;
    });
    ensureModelCacheDirMock.mockResolvedValue("/tmp/shared-cache");

    const generateMock = vi.fn().mockResolvedValue({
      toWav: () => new Uint8Array([1, 2, 3]),
    });
    fromPretrainedMock.mockResolvedValue({ generate: generateMock });

    const { getConfiguredTTSProvider } = await import("./tts.js");
    const provider = getConfiguredTTSProvider();
    expect(provider).not.toBeNull();

    const result = await provider!.synthesize("hello", "af_heart", 1.0);

    expect(ensureModelCacheDirMock).toHaveBeenCalledTimes(1);
    expect(fromPretrainedMock).toHaveBeenCalledWith(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { dtype: "q8", device: "cpu" },
    );
    expect(
      ensureModelCacheDirMock.mock.invocationCallOrder[0],
    ).toBeLessThan(fromPretrainedMock.mock.invocationCallOrder[0]);
    expect(result.contentType).toBe("audio/wav");
    expect(result.audio).toEqual(Buffer.from([1, 2, 3]));
  });
});
