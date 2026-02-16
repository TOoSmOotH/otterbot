import { describe, it, expect } from "vitest";
import { PathInterpolator } from "./path-interpolator";
import type { PathNode } from "./pathfinding";

function makePath(): PathNode[] {
  return [
    { waypointId: "a", position: [0, 0, 0] },
    { waypointId: "b", position: [3, 0, 0] },
    { waypointId: "c", position: [3, 0, 4] },
  ];
}

describe("PathInterpolator", () => {
  it("starts at the first position", () => {
    const interp = new PathInterpolator(makePath(), 1);
    const state = interp.update(0);
    expect(state.position[0]).toBeCloseTo(0);
    expect(state.position[2]).toBeCloseTo(0);
    expect(state.isMoving).toBe(true);
    expect(state.progress).toBeCloseTo(0);
  });

  it("moves along the first segment", () => {
    const interp = new PathInterpolator(makePath(), 3); // 3 units/sec
    const state = interp.update(0.5); // 1.5 units traveled along first segment (length 3)
    expect(state.position[0]).toBeCloseTo(1.5);
    expect(state.position[2]).toBeCloseTo(0);
    expect(state.isMoving).toBe(true);
  });

  it("transitions between segments", () => {
    const interp = new PathInterpolator(makePath(), 7); // 7 units/sec
    // total length = 3 + 4 = 7, so after 0.5s = 3.5 units traveled
    // past segment 1 (3 units), 0.5 units into segment 2
    const state = interp.update(0.5);
    expect(state.position[0]).toBeCloseTo(3);
    expect(state.position[2]).toBeCloseTo(0.5);
    expect(state.isMoving).toBe(true);
  });

  it("finishes at the last position", () => {
    const interp = new PathInterpolator(makePath(), 7);
    // total duration = 7/7 = 1s
    const state = interp.update(2); // way past end
    expect(state.position[0]).toBeCloseTo(3);
    expect(state.position[2]).toBeCloseTo(4);
    expect(state.isMoving).toBe(false);
    expect(state.progress).toBe(1);
    expect(interp.finished).toBe(true);
  });

  it("computes correct rotation Y facing direction", () => {
    const interp = new PathInterpolator(makePath(), 3);
    // Moving along positive X axis: atan2(dx, dz) = atan2(3, 0) = PI/2
    const state = interp.update(0.5);
    expect(state.rotationY).toBeCloseTo(Math.PI / 2);
  });

  it("handles single-point path", () => {
    const interp = new PathInterpolator(
      [{ waypointId: "a", position: [5, 0, 5] }],
      3,
    );
    const state = interp.update(1);
    expect(state.position).toEqual([5, 0, 5]);
    expect(state.isMoving).toBe(false);
  });

  it("accumulates delta across multiple updates", () => {
    const interp = new PathInterpolator(makePath(), 3); // 3 units/sec, total 7 units
    interp.update(0.5); // 1.5 units
    const state = interp.update(0.5); // 3.0 units total (end of segment 1)
    expect(state.position[0]).toBeCloseTo(3);
    expect(state.position[2]).toBeCloseTo(0);
  });
});
