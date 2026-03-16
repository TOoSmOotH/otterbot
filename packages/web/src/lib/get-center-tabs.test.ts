import { describe, it, expect } from "vitest";
import { getCenterTabs, centerViewLabels } from "./get-center-tabs";

describe("getCenterTabs", () => {
  it("returns project-scoped tabs when a project is active (no studios)", () => {
    const tabs = getCenterTabs("project-123");
    expect(tabs).toEqual(["dashboard", "kanban", "charter", "files", "code", "ssh", "settings", "merge-queue"]);
  });

  it("returns project-scoped tabs with studio tabs when studios are enabled", () => {
    const tabs = getCenterTabs("project-123", false, ["games", "apps", "videos"]);
    expect(tabs).toContain("games");
    expect(tabs).toContain("apps");
    expect(tabs).toContain("videos");
    expect(tabs).toEqual(["dashboard", "kanban", "charter", "files", "code", "ssh", "settings", "merge-queue", "games", "apps", "videos"]);
  });

  it("returns only selected studio tabs", () => {
    const tabs = getCenterTabs("project-123", false, ["games"]);
    expect(tabs).toContain("games");
    expect(tabs).not.toContain("apps");
    expect(tabs).not.toContain("videos");
  });

  it("returns global tabs when no project is active (null)", () => {
    const tabs = getCenterTabs(null);
    expect(tabs).toEqual(["dashboard", "todos", "inbox", "calendar", "usage"]);
  });

  it("does not include games in global tabs (studios are project-scoped)", () => {
    expect(getCenterTabs(null)).not.toContain("games");
  });

  it("includes 'code' in project tabs only", () => {
    expect(getCenterTabs("proj-1")).toContain("code");
    expect(getCenterTabs(null)).not.toContain("code");
  });

  it("includes 'ssh' in project tabs only", () => {
    expect(getCenterTabs("proj-1")).toContain("ssh");
    expect(getCenterTabs(null)).not.toContain("ssh");
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

  it("ignores invalid studio names", () => {
    const tabs = getCenterTabs("proj-1", false, ["games", "invalid-studio"]);
    expect(tabs).toContain("games");
    expect(tabs).not.toContain("invalid-studio");
  });
});

describe("getCenterTabs — basic mode", () => {
  it("returns simplified global tabs in basic mode", () => {
    const tabs = getCenterTabs(null, true);
    expect(tabs).toEqual(["dashboard", "todos"]);
  });

  it("returns simplified project tabs in basic mode (no studios)", () => {
    const tabs = getCenterTabs("proj-1", true);
    expect(tabs).toEqual(["dashboard", "kanban", "files", "settings"]);
  });

  it("includes studio tabs in basic project mode when enabled", () => {
    const tabs = getCenterTabs("proj-1", true, ["apps"]);
    expect(tabs).toContain("apps");
    expect(tabs).toEqual(["dashboard", "kanban", "files", "settings", "apps"]);
  });

  it("hides inbox, calendar, and usage in basic global mode", () => {
    const tabs = getCenterTabs(null, true);
    expect(tabs).not.toContain("inbox");
    expect(tabs).not.toContain("calendar");
    expect(tabs).not.toContain("usage");
  });

  it("hides charter, code, ssh, merge-queue in basic project mode", () => {
    const tabs = getCenterTabs("proj-1", true);
    expect(tabs).not.toContain("charter");
    expect(tabs).not.toContain("code");
    expect(tabs).not.toContain("ssh");
    expect(tabs).not.toContain("merge-queue");
  });

  it("advanced mode (isBasic=false) returns full tabs", () => {
    expect(getCenterTabs(null, false)).toEqual(getCenterTabs(null));
    expect(getCenterTabs("proj-1", false)).toEqual(getCenterTabs("proj-1"));
  });
});

describe("centerViewLabels", () => {
  it("has a label for every CenterView value", () => {
    const allViews = [
      "graph", "live3d", "live2d", "dashboard", "charter", "kanban",
      "files", "todos", "inbox", "calendar", "code", "ssh", "settings",
      "merge-queue", "usage", "desktop", "games", "apps", "videos",
    ] as const;
    for (const view of allViews) {
      expect(centerViewLabels[view]).toBeDefined();
      expect(typeof centerViewLabels[view]).toBe("string");
    }
  });

  it("has a label for the live3d view used by the header 3D View link", () => {
    expect(centerViewLabels.live3d).toBe("Live");
  });

  it("has labels for studio views", () => {
    expect(centerViewLabels.games).toBe("Games");
    expect(centerViewLabels.apps).toBe("Apps");
    expect(centerViewLabels.videos).toBe("Videos");
  });
});

describe("header navigation views", () => {
  it("graph, live3d, and desktop are all valid CenterView values with labels", () => {
    expect(centerViewLabels["graph"]).toBeDefined();
    expect(centerViewLabels["live3d"]).toBeDefined();
    expect(centerViewLabels["desktop"]).toBeDefined();
  });

  it("desktop is not in the center tab bar (moved to header)", () => {
    expect(getCenterTabs(null)).not.toContain("desktop");
    expect(getCenterTabs("proj-1")).not.toContain("desktop");
  });
});
