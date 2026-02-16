import type { WaypointGraph, Waypoint, WaypointEdge } from "@otterbot/shared";

export interface PathNode {
  waypointId: string;
  position: [number, number, number];
}

interface AdjacencyEntry {
  neighborId: string;
  weight: number;
}

export type AdjacencyList = Map<string, AdjacencyEntry[]>;

function euclidean(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function buildAdjacencyList(graph: WaypointGraph): AdjacencyList {
  const adj: AdjacencyList = new Map();
  const waypointMap = new Map<string, Waypoint>();

  for (const wp of graph.waypoints) {
    adj.set(wp.id, []);
    waypointMap.set(wp.id, wp);
  }

  for (const edge of graph.edges) {
    const fromWp = waypointMap.get(edge.from);
    const toWp = waypointMap.get(edge.to);
    if (!fromWp || !toWp) continue;

    const weight = edge.weight ?? euclidean(fromWp.position, toWp.position);

    // Bidirectional
    adj.get(edge.from)!.push({ neighborId: edge.to, weight });
    adj.get(edge.to)!.push({ neighborId: edge.from, weight });
  }

  return adj;
}

export function findPath(graph: WaypointGraph, startId: string, endId: string): PathNode[] | null {
  const waypointMap = new Map<string, Waypoint>();
  for (const wp of graph.waypoints) {
    waypointMap.set(wp.id, wp);
  }

  const startWp = waypointMap.get(startId);
  const endWp = waypointMap.get(endId);
  if (!startWp || !endWp) return null;
  if (startId === endId) return [{ waypointId: startId, position: [...startWp.position] }];

  const adj = buildAdjacencyList(graph);

  // A* search
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const openSet: string[] = [startId]; // Simple array-based priority queue (graph <200 nodes)
  const closedSet = new Set<string>();

  gScore.set(startId, 0);
  fScore.set(startId, euclidean(startWp.position, endWp.position));

  while (openSet.length > 0) {
    // Find node with lowest fScore
    let bestIdx = 0;
    let bestF = fScore.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(openSet[i]) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        bestIdx = i;
      }
    }

    const current = openSet[bestIdx];
    if (current === endId) {
      // Reconstruct path
      const path: PathNode[] = [];
      let node: string | undefined = endId;
      while (node !== undefined) {
        const wp = waypointMap.get(node)!;
        path.unshift({ waypointId: node, position: [...wp.position] });
        node = cameFrom.get(node);
      }
      return path;
    }

    openSet.splice(bestIdx, 1);
    closedSet.add(current);

    const neighbors = adj.get(current) ?? [];
    for (const { neighborId, weight } of neighbors) {
      if (closedSet.has(neighborId)) continue;

      const tentativeG = (gScore.get(current) ?? Infinity) + weight;
      const currentG = gScore.get(neighborId) ?? Infinity;

      if (tentativeG < currentG) {
        cameFrom.set(neighborId, current);
        gScore.set(neighborId, tentativeG);
        const neighborWp = waypointMap.get(neighborId)!;
        fScore.set(neighborId, tentativeG + euclidean(neighborWp.position, endWp.position));

        if (!openSet.includes(neighborId)) {
          openSet.push(neighborId);
        }
      }
    }
  }

  return null; // No path found
}

export function findNearestWaypoint(
  graph: WaypointGraph,
  position: [number, number, number],
  filter?: { zoneId?: string; tag?: string },
): Waypoint | null {
  let best: Waypoint | null = null;
  let bestDist = Infinity;

  for (const wp of graph.waypoints) {
    if (filter?.zoneId !== undefined && wp.zoneId !== filter.zoneId) continue;
    if (filter?.tag !== undefined && wp.tag !== filter.tag) continue;

    const dist = euclidean(position, wp.position);
    if (dist < bestDist) {
      bestDist = dist;
      best = wp;
    }
  }

  return best;
}

export function findWaypointsByZoneAndTag(
  graph: WaypointGraph,
  zoneId: string | undefined,
  tag: string,
): Waypoint[] {
  return graph.waypoints.filter((wp) => {
    if (zoneId !== undefined && wp.zoneId !== zoneId) return false;
    return wp.tag === tag;
  });
}
