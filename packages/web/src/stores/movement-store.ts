import { create } from "zustand";
import type { WaypointGraph } from "@otterbot/shared";
import { findPath } from "../lib/pathfinding";
import type { PathNode } from "../lib/pathfinding";
import { PathInterpolator, type InterpolatorState } from "../lib/path-interpolator";
import { AnimationQueue } from "../lib/animation-queue";

export interface MovementEntry {
  interpolator: PathInterpolator;
  state: InterpolatorState;
}

interface MovementState {
  movements: Map<string, MovementEntry>;

  /** Queue a movement for an agent. If already moving, the new movement waits. */
  enqueueMovement: (
    agentId: string,
    graph: WaypointGraph,
    fromWaypointId: string,
    toWaypointId: string,
    speed?: number,
  ) => void;

  /** Start a movement immediately (used internally by the queue). */
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

  /** Check if an agent is actively moving or has pending queued movements */
  isAgentBusy: (agentId: string) => boolean;

  /** Exposed for testing / inspection */
  animationQueue: AnimationQueue;
}

function createAnimationQueue(
  startMovement: MovementState["startMovement"],
  getMovements: () => Map<string, MovementEntry>,
): AnimationQueue {
  return new AnimationQueue(
    startMovement,
    (agentId) => {
      const entry = getMovements().get(agentId);
      return entry != null && !entry.interpolator.finished;
    },
    0.15,
  );
}

export const useMovementStore = create<MovementState>((set, get) => {
  const startMovement: MovementState["startMovement"] = (
    agentId,
    graph,
    fromWaypointId,
    toWaypointId,
    speed = 3,
  ) => {
    const path = findPath(graph, fromWaypointId, toWaypointId);
    if (!path || path.length < 2) return false;

    // If the agent has a recent position, prepend it so the walk starts
    // seamlessly from where the agent visually is (no teleport to waypoint).
    const existing = get().movements.get(agentId);
    let fullPath = path;
    if (existing) {
      const currentPos = existing.state.position;
      const startNode: PathNode = {
        waypointId: "__current__",
        position: [...currentPos],
      };
      fullPath = [startNode, ...path];
    }

    const interpolator = new PathInterpolator(fullPath, speed);
    const state = interpolator.update(0);

    const movements = new Map(get().movements);
    movements.set(agentId, { interpolator, state });
    set({ movements });
    return true;
  };

  const animationQueue = createAnimationQueue(
    startMovement,
    () => get().movements,
  );

  return {
    movements: new Map(),
    animationQueue,
    startMovement,

    enqueueMovement: (agentId, graph, fromWaypointId, toWaypointId, speed) => {
      animationQueue.enqueue(agentId, {
        graph,
        fromWaypointId,
        toWaypointId,
        speed,
      });
    },

    tick: (delta) => {
      const movements = get().movements;

      // Tick active interpolators
      if (movements.size > 0) {
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
      }

      // Process the animation queue (delays + next movements)
      animationQueue.tick(delta);
    },

    getAgentPosition: (agentId) => {
      const entry = get().movements.get(agentId);
      return entry?.state ?? null;
    },

    isAgentBusy: (agentId) => {
      const entry = get().movements.get(agentId);
      const activelyMoving = entry != null && !entry.interpolator.finished;
      return activelyMoving || animationQueue.isBusy(agentId);
    },

    cancelMovement: (agentId) => {
      animationQueue.cancel(agentId);
      const movements = new Map(get().movements);
      movements.delete(agentId);
      set({ movements });
    },
  };
});
