import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecFileSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

describe("local compute detection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.OTTERBOT_GPU_BACKEND;
    delete process.env.OTTERBOT_GPU_VRAM_MB;
    delete process.env.OTTERBOT_GPU_FREE_VRAM_MB;
    delete process.env.OTTERBOT_GPU_NAME;
  });

  it("uses explicit environment overrides when provided", async () => {
    process.env.OTTERBOT_GPU_BACKEND = "nvidia";
    process.env.OTTERBOT_GPU_VRAM_MB = "24576";
    process.env.OTTERBOT_GPU_FREE_VRAM_MB = "16384";
    process.env.OTTERBOT_GPU_NAME = "RTX 4090";

    const { getLocalComputeStatus } = await import("./local-compute.js");
    expect(getLocalComputeStatus()).toMatchObject({
      backend: "nvidia",
      tier: "high",
      gpuName: "RTX 4090",
      totalVramMb: 24576,
      freeVramMb: 16384,
      ready: true,
    });
  });

  it("detects nvidia GPUs via nvidia-smi", async () => {
    mockExecFileSync.mockImplementation((cmd: string) => {
      if (cmd === "nvidia-smi") return "RTX 3080, 10240, 8192";
      throw new Error("unexpected command");
    });

    const { getLocalComputeStatus } = await import("./local-compute.js");
    expect(getLocalComputeStatus()).toMatchObject({
      backend: "nvidia",
      tier: "medium",
      gpuName: "RTX 3080",
      totalVramMb: 10240,
      freeVramMb: 8192,
    });
  });

  it("falls back to cpu when no GPU tools are available", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const { getLocalComputeStatus } = await import("./local-compute.js");
    expect(getLocalComputeStatus()).toMatchObject({
      backend: "cpu",
      tier: "cpu",
      ready: false,
      detected: false,
    });
  });
});
