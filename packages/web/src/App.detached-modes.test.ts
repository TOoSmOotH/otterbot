import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("App detached mode wiring", () => {
  it("routes detached 2D mode to DetachedLive2DView", () => {
    const source = readFileSync(resolve(__dirname, "./App.tsx"), "utf-8");

    expect(source).toContain('import { DetachedLive2DView } from "./components/live-2d-view/DetachedLive2DView";');
    expect(source).toContain('const isDetached2D = new URLSearchParams(window.location.search).has("detached-2d");');
    expect(source).toContain("if (isDetached2D && screen === \"app\") {");
    expect(source).toContain("return <DetachedLive2DView />;");
  });

  it("routes detached graph mode to DetachedAgentGraph", () => {
    const source = readFileSync(resolve(__dirname, "./App.tsx"), "utf-8");

    expect(source).toContain('import { DetachedAgentGraph } from "./components/graph/DetachedAgentGraph";');
    expect(source).toContain('const isDetachedGraph = new URLSearchParams(window.location.search).has("detached-graph");');
    expect(source).toContain("if (isDetachedGraph && screen === \"app\") {");
    expect(source).toContain("return <DetachedAgentGraph />;");
  });
});
