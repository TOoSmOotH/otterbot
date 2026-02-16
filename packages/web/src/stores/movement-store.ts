import { create } from "zustand";
import type { WaypointGraph } from "@otterbot/shared";
import { findPath } from "../lib/pathfinding";
import { PathInterpolator, type InterpolatorState } from "../lib/path-interpolator";

export interface MovementEntry {
  interpolator: PathInterpolator;
  state: InterpolatorState;
}

interface MovementState {
  movements: Map<string, MovementEntry>;

  startMovement: (
    agentId: string,
    graph: WaypointGraph,
    fromWaypointId: string,
    toWaypointId: string,
    speed?: number,
  ) => boolean;

  tick: (delta: number) => void;

  getAgentPosition: (agentId: string) => InterpolatorState | null;

  cancelMovement: (agentId: string) => void;
}

export const useMovementStore = create<MovementState>((set, get) => ({
  movements: new Map(),

  startMovement: (agentId, graph, fromWaypointId, toWaypointId, speed = 3) => {
    const path = findPath(graph, fromWaypointId, toWaypointId);
    if (!path || path.length < 2) return false;

    const interpolator = new PathInterpolator(path, speed);
    const state = interpolator.update(0);

    const movements = new Map(get().movements);
    movements.set(agentId, { interpolator, state });
    set({ movements });
    return true;
  },

  tick: (delta) => {
    const movements = get().movements;
    if (movements.size === 0) return;

    const next = new Map(movements);
    let changed = false;

    for (const [agentId, entry] of next) {
      if (entry.interpolator.finished) {
        next.delete(agentId);
        changed = true;
        continue;
      }

      const state = entry.interpolator.update(delta);
      next.set(agentId, { ...entry, state });
      changed = true;

      if (entry.interpolator.finished) {
        next.delete(agentId);
      }
    }

    if (changed) {
      set({ movements: next });
    }
  },

  getAgentPosition: (agentId) => {
    const entry = get().movements.get(agentId);
    return entry?.state ?? null;
  },

  cancelMovement: (agentId) => {
    const movements = new Map(get().movements);
    movements.delete(agentId);
    set({ movements });
  },
}));
