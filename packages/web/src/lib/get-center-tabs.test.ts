import { describe, it, expect } from "vitest";
import { getCenterTabs, centerViewLabels } from "./get-center-tabs";

describe("getCenterTabs", () => {
  it("returns project-scoped tabs when a project is active", () => {
    const tabs = getCenterTabs("project-123");
    expect(tabs).toEqual(["dashboard", "kanban", "charter", "files", "code", "settings"]);
  });

  it("returns global tabs when no project is active (null)", () => {
    const tabs = getCenterTabs(null);
    expect(tabs).toEqual(["dashboard", "todos", "inbox", "calendar", "code", "usage"]);
  });

  it("includes 'code' in both project and global tabs", () => {
    expect(getCenterTabs("proj-1")).toContain("code");
    expect(getCenterTabs(null)).toContain("code");
  });

  it("does not include graph in project tabs", () => {
    expect(getCenterTabs("proj-1")).not.toContain("graph");
  });

  it("does not include live3d in project or global tabs (header-only navigation)", () => {
    expect(getCenterTabs("proj-1")).not.toContain("live3d");
    expect(getCenterTabs(null)).not.toContain("live3d");
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

  it("has a label for the live3d view used by the header 3D View link", () => {
    expect(centerViewLabels.live3d).toBe("Live");
  });
});

describe("header navigation views", () => {
  it("graph, live3d, and desktop are all valid CenterView values with labels", () => {
    // The header provides direct navigation to graph, live3d, and desktop views
    // (outside the tab bar). All must remain valid CenterView values.
    expect(centerViewLabels["graph"]).toBeDefined();
    expect(centerViewLabels["live3d"]).toBeDefined();
    expect(centerViewLabels["desktop"]).toBeDefined();
  });

  it("desktop is not in the center tab bar (moved to header)", () => {
    expect(getCenterTabs(null)).not.toContain("desktop");
    expect(getCenterTabs("proj-1")).not.toContain("desktop");
  });
});
