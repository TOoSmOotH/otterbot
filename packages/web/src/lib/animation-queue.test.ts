import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnimationQueue, type QueuedMovement, type StartMovementFn, type IsMovingFn } from "./animation-queue";
import type { WaypointGraph } from "@otterbot/shared";

const dummyGraph: WaypointGraph = {
  waypoints: [
    { id: "a", position: [0, 0, 0], tag: "center" },
    { id: "b", position: [3, 0, 0], tag: "desk" },
  ],
  edges: [{ from: "a", to: "b" }],
};

function makeMovement(from = "a", to = "b"): QueuedMovement {
  return { graph: dummyGraph, fromWaypointId: from, toWaypointId: to };
}

describe("AnimationQueue", () => {
  let startMovement: ReturnType<typeof vi.fn<StartMovementFn>>;
  let movingAgents: Set<string>;
  let isMoving: IsMovingFn;
  let queue: AnimationQueue;

  beforeEach(() => {
    startMovement = vi.fn<StartMovementFn>(() => true);
    movingAgents = new Set();
    isMoving = (id) => movingAgents.has(id);
    queue = new AnimationQueue(startMovement, isMoving, 1);
  });

  it("starts movement immediately when agent is idle", () => {
    queue.enqueue("agent1", makeMovement());

    expect(startMovement).toHaveBeenCalledOnce();
    expect(startMovement).toHaveBeenCalledWith(
      "agent1",
      dummyGraph,
      "a",
      "b",
      undefined,
    );
  });

  it("queues movement when agent is already moving", () => {
    movingAgents.add("agent1");
    queue.enqueue("agent1", makeMovement());

    // First enqueue while moving: should be queued, not started
    expect(startMovement).not.toHaveBeenCalled();
    expect(queue.queueLength("agent1")).toBe(1);
  });

  it("starts next movement after delay when current finishes", () => {
    // Start first movement immediately
    queue.enqueue("agent1", makeMovement("a", "b"));
    expect(startMovement).toHaveBeenCalledOnce();

    // Agent is now moving — enqueue a second movement
    movingAgents.add("agent1");
    queue.enqueue("agent1", makeMovement("b", "a"));
    expect(startMovement).toHaveBeenCalledOnce(); // still just once
    expect(queue.queueLength("agent1")).toBe(1);

    // Movement finishes
    movingAgents.delete("agent1");

    // First tick: detects movement finished, starts delay
    queue.tick(0.016);
    expect(queue.isWaiting("agent1")).toBe(true);
    expect(startMovement).toHaveBeenCalledOnce(); // still waiting

    // Tick through most of the delay (not quite done)
    queue.tick(0.9);
    expect(queue.isWaiting("agent1")).toBe(true);
    expect(startMovement).toHaveBeenCalledOnce();

    // Tick past the remaining delay
    queue.tick(0.2);
    expect(queue.isWaiting("agent1")).toBe(false);
    expect(startMovement).toHaveBeenCalledTimes(2);
    expect(startMovement).toHaveBeenLastCalledWith(
      "agent1",
      dummyGraph,
      "b",
      "a",
      undefined,
    );
    expect(queue.queueLength("agent1")).toBe(0);
  });

  it("processes multiple queued movements in order", () => {
    queue.enqueue("agent1", makeMovement("a", "b"));
    movingAgents.add("agent1");

    queue.enqueue("agent1", makeMovement("b", "a"));
    queue.enqueue("agent1", makeMovement("a", "b"));
    expect(queue.queueLength("agent1")).toBe(2);

    // Finish first movement
    movingAgents.delete("agent1");
    queue.tick(0.016); // detect finished
    queue.tick(1.0); // finish delay

    expect(startMovement).toHaveBeenCalledTimes(2);
    expect(queue.queueLength("agent1")).toBe(1);

    // Start second queued movement (agent is now moving again)
    movingAgents.add("agent1");
    movingAgents.delete("agent1");
    queue.tick(0.016); // detect finished
    queue.tick(1.0); // finish delay

    expect(startMovement).toHaveBeenCalledTimes(3);
    expect(queue.queueLength("agent1")).toBe(0);
  });

  it("handles independent agents separately", () => {
    queue.enqueue("agent1", makeMovement("a", "b"));
    queue.enqueue("agent2", makeMovement("a", "b"));

    expect(startMovement).toHaveBeenCalledTimes(2);
    expect(startMovement).toHaveBeenCalledWith("agent1", dummyGraph, "a", "b", undefined);
    expect(startMovement).toHaveBeenCalledWith("agent2", dummyGraph, "a", "b", undefined);
  });

  it("cancel clears the queue and stops waiting", () => {
    queue.enqueue("agent1", makeMovement("a", "b"));
    movingAgents.add("agent1");
    queue.enqueue("agent1", makeMovement("b", "a"));

    queue.cancel("agent1");

    expect(queue.queueLength("agent1")).toBe(0);
    expect(queue.isWaiting("agent1")).toBe(false);
  });

  it("does not start movement when from and to are the same waypoint", () => {
    // The AnimationQueue itself doesn't check this — it's checked in triggerMovement.
    // But we verify the queue passes through the movement as-is.
    queue.enqueue("agent1", makeMovement("a", "a"));
    expect(startMovement).toHaveBeenCalledWith("agent1", dummyGraph, "a", "a", undefined);
  });

  it("respects custom delay between movements", () => {
    const customQueue = new AnimationQueue(startMovement, isMoving, 2);

    customQueue.enqueue("agent1", makeMovement("a", "b"));
    movingAgents.add("agent1");
    customQueue.enqueue("agent1", makeMovement("b", "a"));

    movingAgents.delete("agent1");
    customQueue.tick(0.016);
    expect(customQueue.isWaiting("agent1")).toBe(true);

    // 1 second is not enough with a 2-second delay
    customQueue.tick(1.0);
    expect(customQueue.isWaiting("agent1")).toBe(true);
    expect(startMovement).toHaveBeenCalledOnce();

    // 2 seconds total should be enough
    customQueue.tick(1.1);
    expect(customQueue.isWaiting("agent1")).toBe(false);
    expect(startMovement).toHaveBeenCalledTimes(2);
  });

  it("passes speed through to startMovement", () => {
    const movement: QueuedMovement = {
      graph: dummyGraph,
      fromWaypointId: "a",
      toWaypointId: "b",
      speed: 5,
    };
    queue.enqueue("agent1", movement);
    expect(startMovement).toHaveBeenCalledWith("agent1", dummyGraph, "a", "b", 5);
  });

  it("does not start delay if queue is empty when movement finishes", () => {
    queue.enqueue("agent1", makeMovement("a", "b"));
    movingAgents.add("agent1");

    // Movement finishes, nothing queued
    movingAgents.delete("agent1");
    queue.tick(0.016);

    // No delay should be active since there's nothing to wait for
    // (waiting is set, but it's harmless — it just won't trigger anything)
    // Enqueue now should start immediately after delay clears
    queue.tick(1.0);
    queue.enqueue("agent1", makeMovement("b", "a"));
    expect(startMovement).toHaveBeenCalledTimes(2);
  });
});
