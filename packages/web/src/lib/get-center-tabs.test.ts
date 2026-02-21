import { describe, it, expect } from "vitest";
import { getCenterTabs, centerViewLabels } from "./get-center-tabs";

describe("getCenterTabs", () => {
  it("returns project-scoped tabs when a project is active", () => {
    const tabs = getCenterTabs("project-123");
    expect(tabs).toEqual(["dashboard", "kanban", "charter", "files", "code", "settings"]);
  });

  it("returns global tabs when no project is active (null)", () => {
    const tabs = getCenterTabs(null);
    expect(tabs).toEqual(["dashboard", "todos", "inbox", "calendar", "code", "usage", "desktop"]);
  });

  it("includes 'code' in both project and global tabs", () => {
    expect(getCenterTabs("proj-1")).toContain("code");
    expect(getCenterTabs(null)).toContain("code");
  });

  it("does not include graph in project tabs", () => {
    expect(getCenterTabs("proj-1")).not.toContain("graph");
  });

  it("includes settings only in project tabs", () => {
    expect(getCenterTabs("proj-1")).toContain("settings");
    expect(getCenterTabs(null)).not.toContain("settings");
  });
});

describe("centerViewLabels", () => {
  it("has a label for every CenterView value", () => {
    const allViews = [
      "graph", "live3d", "dashboard", "charter", "kanban",
      "files", "todos", "inbox", "calendar", "code", "settings", "usage", "desktop",
    ] as const;
    for (const view of allViews) {
      expect(centerViewLabels[view]).toBeDefined();
      expect(typeof centerViewLabels[view]).toBe("string");
    }
  });
});
