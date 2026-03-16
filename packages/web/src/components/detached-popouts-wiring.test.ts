import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Detached view and pop-out wiring", () => {
  it("wires 2D view pop-out button and detached loader setup", () => {
    const live2DSource = readFileSync(resolve(__dirname, "./live-2d-view/Live2DView.tsx"), "utf-8");
    const detached2DSource = readFileSync(resolve(__dirname, "./live-2d-view/DetachedLive2DView.tsx"), "utf-8");

    expect(live2DSource).toContain('title="Pop out 2D View"');
    expect(live2DSource).toContain('window.open(window.location.origin + "?detached-2d=true", "Detached2D", "width=1200,height=800")');

    expect(detached2DSource).toContain('fetch("/api/profile")');
    expect(detached2DSource).toContain('fetch("/api/agents")');
    expect(detached2DSource).toContain("initMovementTriggers();");
    expect(detached2DSource).toContain("initBreakRoomRoaming();");
    expect(detached2DSource).toContain("Loading 2D View...");
  });

  it("wires graph pop-out button and detached graph loader setup", () => {
    const graphSource = readFileSync(resolve(__dirname, "./graph/AgentGraph.tsx"), "utf-8");
    const detachedGraphSource = readFileSync(resolve(__dirname, "./graph/DetachedAgentGraph.tsx"), "utf-8");

    expect(graphSource).toContain('title="Pop out Agent Graph"');
    expect(graphSource).toContain('window.open(window.location.origin + "?detached-graph=true", "DetachedGraph", "width=1200,height=800")');

    expect(detachedGraphSource).toContain('fetch("/api/profile")');
    expect(detachedGraphSource).toContain('fetch("/api/agents")');
    expect(detachedGraphSource).toContain("Loading Agent Graph...");
  });
});
