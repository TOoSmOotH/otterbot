import { describe, expect, it } from "vitest";
import { clampToolPayload } from "./agent-runtime.js";

describe("clampToolPayload", () => {
  it("leaves small values untouched", () => {
    expect(clampToolPayload("hi")).toBe("hi");
    expect(clampToolPayload(42)).toBe(42);
    expect(clampToolPayload({ ok: true, exitCode: 0 })).toEqual({ ok: true, exitCode: 0 });
  });

  it("truncates an oversized string with a marker", () => {
    const big = "x".repeat(50);
    const out = clampToolPayload(big, 10) as string;
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("[truncated 40 chars]");
    expect(out.length).toBeLessThan(big.length);
  });

  it("clamps long string fields inside an object but keeps structure", () => {
    const result = { ok: true, exitCode: 0, summary: "y".repeat(100) };
    const out = clampToolPayload(result, 10) as typeof result;
    expect(out.ok).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.summary).toContain("[truncated 90 chars]");
  });

  it("clamps strings nested in arrays", () => {
    const out = clampToolPayload({ items: ["z".repeat(40)] }, 5) as { items: string[] };
    expect(out.items[0]).toContain("[truncated 35 chars]");
  });

  it("passes null and undefined through", () => {
    expect(clampToolPayload(null)).toBeNull();
    expect(clampToolPayload(undefined)).toBeUndefined();
  });
});
