import { describe, it, expect } from "vitest";
import { THEMES } from "./themes";

describe("THEMES", () => {
  it("includes Playful Pop with the indigo background", () => {
    expect(THEMES.playful).toBeDefined();
    expect(THEMES.playful.label).toBe("Playful Pop");
    expect(THEMES.playful.vars["--bg"]).toBe("18 19 39");
    expect(THEMES.playful.vars["--accent"]).toBe("61 215 196");
  });

  it("every theme defines the same set of variables", () => {
    const keys = Object.keys(THEMES.obsidian.vars).sort();
    for (const id of Object.keys(THEMES)) {
      expect(Object.keys(THEMES[id as keyof typeof THEMES].vars).sort()).toEqual(keys);
    }
  });
});
