import { describe, it, expect } from "vitest";
import { findPath } from "./pathfind";
import { Cell } from "./geometry";
import type { World } from "./worldLayout";

function tinyWorld(): World {
  const cols = 5;
  const rows = 5;
  const grid = new Uint8Array(cols * rows).fill(Cell.FLOOR);
  const set = (x: number, y: number, v: Cell) => (grid[y * cols + x] = v);
  for (let x = 0; x < cols; x++) {
    set(x, 0, Cell.WALL);
    set(x, rows - 1, Cell.WALL);
  }
  for (let y = 0; y < rows; y++) {
    set(0, y, Cell.WALL);
    set(cols - 1, y, Cell.WALL);
  }
  set(2, 2, Cell.DESK);
  set(2, rows - 1, Cell.DOOR);
  return { cols, rows, grid, rooms: [], deskOf: {}, pxWidth: 80, pxHeight: 80 };
}

describe("findPath", () => {
  const w = tinyWorld();

  it("routes between two floor tiles avoiding walls and desks", () => {
    const path = findPath(w, { tx: 1, ty: 1 }, { tx: 3, ty: 3 });
    expect(path.length).toBeGreaterThan(0);
    expect(path[0]).toEqual({ tx: 1, ty: 1 });
    expect(path[path.length - 1]).toEqual({ tx: 3, ty: 3 });
    for (const p of path) expect(w.grid[p.ty * w.cols + p.tx]).not.toBe(Cell.DESK);
    for (const p of path) expect(w.grid[p.ty * w.cols + p.tx]).not.toBe(Cell.WALL);
  });

  it("can step onto a door tile", () => {
    const path = findPath(w, { tx: 1, ty: 1 }, { tx: 2, ty: 4 });
    expect(path[path.length - 1]).toEqual({ tx: 2, ty: 4 });
  });

  it("returns empty when the goal is unreachable (a wall)", () => {
    expect(findPath(w, { tx: 1, ty: 1 }, { tx: 0, ty: 0 })).toEqual([]);
  });

  it("returns a single-tile path when start equals goal", () => {
    expect(findPath(w, { tx: 1, ty: 1 }, { tx: 1, ty: 1 })).toEqual([{ tx: 1, ty: 1 }]);
  });
});
