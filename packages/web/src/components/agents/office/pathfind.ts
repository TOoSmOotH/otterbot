import { Cell, isWalkable, type Pt } from "./geometry";
import type { World } from "./worldLayout";

/**
 * Breadth-first path between two tiles over walkable cells (FLOOR/DOOR).
 * Returns the inclusive tile path [start..goal], or [] if unreachable.
 * Uniform step cost, so BFS yields a shortest path.
 */
export function findPath(world: World, start: Pt, goal: Pt): Pt[] {
  const { cols, rows, grid } = world;
  const idx = (x: number, y: number) => y * cols + x;
  const walk = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && isWalkable(grid[idx(x, y)] as Cell);

  if (!walk(goal.tx, goal.ty)) return [];
  if (start.tx === goal.tx && start.ty === goal.ty) return [{ tx: start.tx, ty: start.ty }];
  if (!walk(start.tx, start.ty)) return [];

  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [idx(start.tx, start.ty)];
  seen[queue[0]] = 1;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const goalI = idx(goal.tx, goal.ty);

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur === goalI) break;
    const cx = cur % cols;
    const cy = (cur - cx) / cols;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walk(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (seen[ni]) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }

  if (!seen[goalI]) return [];
  const path: Pt[] = [];
  let cur = goalI;
  while (cur !== -1) {
    const x = cur % cols;
    path.push({ tx: x, ty: (cur - x) / cols });
    cur = prev[cur];
  }
  return path.reverse();
}
