import { describe, it, expect } from "vitest";
import { extractProjectLabel } from "../world-layout.js";

describe("extractProjectLabel", () => {
  it("strips the 6-char nanoid suffix from a project ID", () => {
    expect(extractProjectLabel("awesome-a7kh9d")).toBe("awesome");
  });

  it("handles multi-segment slugs", () => {
    expect(extractProjectLabel("my-cool-project-a7kh9d")).toBe("my-cool-project");
  });

  it("returns the full ID when there is no 6-char suffix", () => {
    expect(extractProjectLabel("standalone")).toBe("standalone");
  });

  it("returns the full ID when the suffix is not exactly 6 chars", () => {
    expect(extractProjectLabel("project-abc")).toBe("project-abc");
    expect(extractProjectLabel("project-abcdefgh")).toBe("project-abcdefgh");
  });

  it("handles an ID that is only a nanoid (no slug prefix)", () => {
    // nanoid(6) alone has no hyphen, so it should be returned as-is
    expect(extractProjectLabel("a7kh9d")).toBe("a7kh9d");
  });
});
