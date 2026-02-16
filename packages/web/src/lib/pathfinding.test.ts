import { describe, it, expect } from "vitest";
import { buildAdjacencyList, findPath, findNearestWaypoint, findWaypointsByZoneAndTag } from "./pathfinding";
import type { WaypointGraph } from "@otterbot/shared";

function makeGraph(): WaypointGraph {
  return {
    waypoints: [
      { id: "a", position: [0, 0, 0], tag: "entrance", zoneId: "main" },
      { id: "b", position: [5, 0, 0], tag: "hallway" },
      { id: "c", position: [10, 0, 0], tag: "center", zoneId: "main" },
      { id: "d", position: [5, 0, 5], tag: "desk", zoneId: "proj1" },
      { id: "e", position: [10, 0, 5], tag: "entrance", zoneId: "proj1" },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "b", to: "d" },
      { from: "d", to: "e" },
      { from: "c", to: "e" },
    ],
  };
}

describe("buildAdjacencyList", () => {
  it("creates bidirectional edges", () => {
    const adj = buildAdjacencyList(makeGraph());
    expect(adj.get("a")!.length).toBe(1);
    expect(adj.get("b")!.length).toBe(3); // a, c, d
    expect(adj.get("a")![0].neighborId).toBe("b");
    // b should have a as neighbor too
    expect(adj.get("b")!.some((e) => e.neighborId === "a")).toBe(true);
  });

  it("computes euclidean weights by default", () => {
    const adj = buildAdjacencyList(makeGraph());
    const abEdge = adj.get("a")!.find((e) => e.neighborId === "b")!;
    expect(abEdge.weight).toBeCloseTo(5);
  });
});

describe("findPath", () => {
  it("finds direct path between adjacent nodes", () => {
    const graph = makeGraph();
    const path = findPath(graph, "a", "b");
    expect(path).not.toBeNull();
    expect(path!.length).toBe(2);
    expect(path![0].waypointId).toBe("a");
    expect(path![1].waypointId).toBe("b");
  });

  it("finds shortest path through graph", () => {
    const graph = makeGraph();
    const path = findPath(graph, "a", "e");
    expect(path).not.toBeNull();
    // a -> b -> d -> e (length ~15.07) vs a -> b -> c -> e (length ~15)
    // Both are similar but A* should find one of them
    expect(path!.length).toBeGreaterThanOrEqual(3);
    expect(path![0].waypointId).toBe("a");
    expect(path![path!.length - 1].waypointId).toBe("e");
  });

  it("returns single node for same start and end", () => {
    const graph = makeGraph();
    const path = findPath(graph, "a", "a");
    expect(path).toEqual([{ waypointId: "a", position: [0, 0, 0] }]);
  });

  it("returns null for disconnected nodes", () => {
    const graph: WaypointGraph = {
      waypoints: [
        { id: "x", position: [0, 0, 0] },
        { id: "y", position: [10, 0, 0] },
      ],
      edges: [],
    };
    expect(findPath(graph, "x", "y")).toBeNull();
  });

  it("returns null for nonexistent nodes", () => {
    expect(findPath(makeGraph(), "a", "zzz")).toBeNull();
  });

  it("prefers shorter path when weights differ", () => {
    const graph: WaypointGraph = {
      waypoints: [
        { id: "s", position: [0, 0, 0] },
        { id: "m", position: [1, 0, 0] },
        { id: "e", position: [2, 0, 0] },
      ],
      edges: [
        { from: "s", to: "m", weight: 1 },
        { from: "m", to: "e", weight: 1 },
        { from: "s", to: "e", weight: 100 },
      ],
    };
    const path = findPath(graph, "s", "e")!;
    expect(path.length).toBe(3); // s -> m -> e (cost 2) not s -> e (cost 100)
  });
});

describe("findNearestWaypoint", () => {
  it("finds closest waypoint by position", () => {
    const graph = makeGraph();
    const nearest = findNearestWaypoint(graph, [4, 0, 0]);
    expect(nearest).not.toBeNull();
    expect(nearest!.id).toBe("b");
  });

  it("filters by zoneId", () => {
    const graph = makeGraph();
    const nearest = findNearestWaypoint(graph, [4, 0, 0], { zoneId: "proj1" });
    expect(nearest).not.toBeNull();
    expect(nearest!.zoneId).toBe("proj1");
  });

  it("filters by tag", () => {
    const graph = makeGraph();
    const nearest = findNearestWaypoint(graph, [0, 0, 0], { tag: "desk" });
    expect(nearest).not.toBeNull();
    expect(nearest!.id).toBe("d");
  });

  it("returns null when no match", () => {
    const graph = makeGraph();
    expect(findNearestWaypoint(graph, [0, 0, 0], { tag: "nonexistent" })).toBeNull();
  });
});

describe("findWaypointsByZoneAndTag", () => {
  it("finds waypoints matching zone and tag", () => {
    const graph = makeGraph();
    const result = findWaypointsByZoneAndTag(graph, "main", "entrance");
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("a");
  });

  it("returns empty for no matches", () => {
    const graph = makeGraph();
    expect(findWaypointsByZoneAndTag(graph, "main", "desk")).toEqual([]);
  });
});
