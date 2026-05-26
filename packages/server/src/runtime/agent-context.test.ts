import { describe, expect, it } from "vitest";
import { resolveTurnLimits } from "./agent-context.js";

const defaults = { browseTimeoutMs: 60_000, maxSteps: 8 };

describe("resolveTurnLimits", () => {
  it("uses defaults when overrides are null", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: null, maxSteps: null }, defaults)).toEqual({
      browseTimeoutMs: 60_000,
      maxSteps: 8,
    });
  });

  it("uses positive overrides", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: 180_000, maxSteps: 16 }, defaults)).toEqual({
      browseTimeoutMs: 180_000,
      maxSteps: 16,
    });
  });

  it("falls back to defaults for non-positive or non-finite overrides", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: 0, maxSteps: -1 }, defaults)).toEqual(defaults);
    expect(
      resolveTurnLimits({ browseTimeoutMs: NaN, maxSteps: Infinity }, defaults)
    ).toEqual(defaults);
  });
});
