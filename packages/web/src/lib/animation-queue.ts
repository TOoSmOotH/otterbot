import type { WaypointGraph } from "@otterbot/shared";

export interface QueuedMovement {
  graph: WaypointGraph;
  fromWaypointId: string;
  toWaypointId: string;
  speed?: number;
}

interface AgentQueueState {
  queue: QueuedMovement[];
  /** Seconds remaining in the delay between movements */
  delayRemaining: number;
  /** Whether the agent is currently waiting between movements */
  waiting: boolean;
}

export type StartMovementFn = (
  agentId: string,
  graph: WaypointGraph,
  fromWaypointId: string,
  toWaypointId: string,
  speed?: number,
) => boolean;

export type IsMovingFn = (agentId: string) => boolean;

/**
 * Queues animation movements per agent instead of executing them immediately.
 *
 * When a movement is enqueued:
 * - If the agent has no active movement, it starts immediately.
 * - If the agent is already moving, the new movement is added to the queue.
 *
 * After each movement finishes, a configurable delay (default 1s) elapses
 * before the next queued movement begins.
 */
export class AnimationQueue {
  private agents = new Map<string, AgentQueueState>();
  private delayBetween: number;
  private startMovement: StartMovementFn;
  private isMoving: IsMovingFn;

  constructor(
    startMovement: StartMovementFn,
    isMoving: IsMovingFn,
    delayBetween: number = 1,
  ) {
    this.startMovement = startMovement;
    this.isMoving = isMoving;
    this.delayBetween = delayBetween;
  }

  /**
   * Add a movement to an agent's queue. If the agent is idle, it starts immediately.
   */
  enqueue(agentId: string, movement: QueuedMovement): void {
    let state = this.agents.get(agentId);
    if (!state) {
      state = { queue: [], delayRemaining: 0, waiting: false };
      this.agents.set(agentId, state);
    }

    // If the agent is not moving and not waiting, start immediately
    if (!this.isMoving(agentId) && !state.waiting && state.queue.length === 0) {
      this.startMovement(
        agentId,
        movement.graph,
        movement.fromWaypointId,
        movement.toWaypointId,
        movement.speed,
      );
    } else {
      state.queue.push(movement);
    }
  }

  /**
   * Process the queue each frame. Call this from the render loop with the frame delta (seconds).
   *
   * For each agent:
   * - If waiting (delay between movements), count down the delay.
   * - If not moving and not waiting and queue has items, start the next movement.
   * - If a movement just finished, begin the delay timer.
   */
  tick(delta: number): void {
    for (const [agentId, state] of this.agents) {
      const moving = this.isMoving(agentId);

      if (state.waiting) {
        state.delayRemaining -= delta;
        if (state.delayRemaining <= 0) {
          state.waiting = false;
          state.delayRemaining = 0;
          // Start next queued movement if any
          this.processNext(agentId, state);
        }
        continue;
      }

      if (!moving && state.queue.length > 0) {
        // Movement just finished — start the inter-movement delay
        state.waiting = true;
        state.delayRemaining = this.delayBetween;
      }
    }
  }

  private processNext(agentId: string, state: AgentQueueState): void {
    if (state.queue.length === 0) return;
    const next = state.queue.shift()!;
    this.startMovement(
      agentId,
      next.graph,
      next.fromWaypointId,
      next.toWaypointId,
      next.speed,
    );
  }

  /**
   * Cancel all queued movements for an agent.
   */
  cancel(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Get the number of queued (pending) movements for an agent.
   */
  queueLength(agentId: string): number {
    return this.agents.get(agentId)?.queue.length ?? 0;
  }

  /**
   * Check whether an agent is in the delay period between movements.
   */
  isWaiting(agentId: string): boolean {
    return this.agents.get(agentId)?.waiting ?? false;
  }

  /**
   * Returns true if the agent has queued movements OR is in the inter-movement delay.
   * Use this to prevent idle lerping while the queue is about to start a walk.
   */
  isBusy(agentId: string): boolean {
    const state = this.agents.get(agentId);
    if (!state) return false;
    return state.waiting || state.queue.length > 0;
  }
}
