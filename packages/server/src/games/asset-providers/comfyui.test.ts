import { describe, expect, it } from "vitest";
import { chooseComfyPreset, listComfyPresets } from "./comfyui.js";

describe("ComfyUI preset selection", () => {
  it("chooses sprite preset for sprite tasks", () => {
    expect(chooseComfyPreset({ taskType: "sprite" }).id).toBe("sprite-pixel-v1");
  });

  it("falls back to general image preset", () => {
    expect(chooseComfyPreset().id).toBe("general-image-v1");
  });

  it("exposes a preset catalog for studio tasks", () => {
    const ids = listComfyPresets().map((preset) => preset.id);
    expect(ids).toContain("texture-tile-v1");
    expect(ids).toContain("hero-concept-v1");
  });
});
