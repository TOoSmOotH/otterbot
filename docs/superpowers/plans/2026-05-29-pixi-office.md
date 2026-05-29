# PixiJS Pixel-Art Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DOM "Office" sub-tab in the Network view with a top-down PixiJS v8 pixel-art office where each agent is its avatar at a desk, project teams sit in walled rooms, and live activity (status, delegation walks, bubbles, pipeline whiteboards, ambient day/night) animates the scene.

**Architecture:** One imperative Pixi `Application` mounted by a thin React wrapper (`PixiOffice.tsx`). The wrapper subscribes to the existing Zustand stores via their vanilla `.subscribe()` (so Socket.IO churn never re-renders React) and pushes diffs into an `OfficeScene` controller. Pure modules (`worldLayout`, `pathfind`) compute the building grid and route tokens through doors; rendering modules (`tiles`, `AgentToken`, `whiteboard`) draw the scene. The office is fully functional on programmatic `Graphics`; a Kenney CC0 atlas overlays as the final task.

**Tech Stack:** React 19, Zustand, **pixi.js v8** (new), **vitest** (new, for the pure modules), TypeScript, inline CSS theming via `rgb(var(--token))`.

**Reference spec:** `docs/superpowers/specs/2026-05-29-pixi-office-design.md`

---

## File Structure

New directory `packages/web/src/components/agents/office/`:

| File | Responsibility |
|---|---|
| `geometry.ts` | Shared constants/types: `TILE`, `Cell` enum, `Pt`, `tilePx()`. No deps. |
| `worldLayout.ts` | Pure. `buildWorld(agents, projects)` → walled-room grid + desk slots + doors + whiteboards. |
| `worldLayout.test.ts` | vitest for `buildWorld`. |
| `pathfind.ts` | Pure. `findPath(world, start, goal)` BFS through walkable tiles/doors. |
| `pathfind.test.ts` | vitest for `findPath`. |
| `tiles.ts` | Environment rendering: `Graphics` drawers for floor/wall/door/desk/whiteboard/props; later overlays a Kenney atlas. |
| `AgentToken.ts` | One agent's token: avatar sprite/initials, status ring, bubble, walk animation (`update(dt)`). |
| `whiteboard.ts` | Renders a project's pipeline run as stage chips + goal. |
| `OfficeScene.ts` | Owns the Pixi stage/layers; `setWorld/setStatus/onMessage/setPipeline/resize/setReducedMotion/destroy`; ticker drives all animation. |
| `PixiOffice.tsx` | React wrapper: Application lifecycle, ResizeObserver, store bridge. |

Edited: `NetworkView.tsx` (render `<PixiOffice>`), `packages/web/package.json`, `packages/web/vitest.config.ts` (new), `e2e/05-office.spec.ts` (new smoke).
Removed: `office-layout.ts`, `AgentOffice.tsx`.

All commits use the repo convention (no `Co-Authored-By` / no Claude footer, per user global prefs).

---

## Task 0: Dependencies + vitest scaffold

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`

- [ ] **Step 1: Add deps**

Run:
```bash
cd /home/mreeves/Projects/Personal/otter/otterbot
pnpm --filter @otterbot/web add pixi.js
pnpm --filter @otterbot/web add -D vitest
```

- [ ] **Step 2: Add a `test` script to `packages/web/package.json`**

In the `"scripts"` block, add (keep existing scripts):
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `packages/web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet = ok)**

Run: `pnpm --filter @otterbot/web test`
Expected: exits 0 with "No test files found" (or similar). If it errors on config, fix before proceeding.

- [ ] **Step 5: Verify the app still builds with pixi installed**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/pnpm-lock.yaml pnpm-lock.yaml packages/web/vitest.config.ts
git commit -m "Add pixi.js and vitest to web package"
```

---

## Task 1: geometry constants

**Files:**
- Create: `packages/web/src/components/agents/office/geometry.ts`

- [ ] **Step 1: Write `geometry.ts`**

```ts
/** Logical pixels per tile in world space (before camera scaling). */
export const TILE = 16;

/** Grid cell kinds. Walkable = FLOOR or DOOR. */
export enum Cell {
  WALL = 0,
  FLOOR = 1,
  DOOR = 2,
  DESK = 3,
}

export interface Pt {
  tx: number;
  ty: number;
}

/** Center of a tile, in world px. */
export function tilePx(t: number): number {
  return t * TILE + TILE / 2;
}

export function isWalkable(cell: Cell): boolean {
  return cell === Cell.FLOOR || cell === Cell.DOOR;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/agents/office/geometry.ts
git commit -m "Add office geometry constants"
```

---

## Task 2: worldLayout (TDD)

Builds the walled-room building from agents + projects. Outer wall border; one walled room per project (desks in a grid, one door on the bottom wall, a whiteboard strip on the top interior wall); a COO room; an open (wall-less) "Unassigned" cluster. Everything outside rooms is FLOOR (the corridor), guaranteeing connectivity — tokens leave a room only through its door.

**Files:**
- Create: `packages/web/src/components/agents/office/worldLayout.ts`
- Test: `packages/web/src/components/agents/office/worldLayout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildWorld } from "./worldLayout";
import { Cell } from "./geometry";
import type { AgentProfileSummary } from "@otterbot/shared";
import type { Project } from "../../../stores/projects-store";

function agent(id: string, role: AgentProfileSummary["role"]): AgentProfileSummary {
  return {
    id,
    displayName: id,
    role,
    status: "idle",
    chatModel: { provider: "x", account: "default", modelId: "m" },
    artwork: { avatar: null },
    parentId: null,
    activeSubagents: 0,
  };
}

function project(id: string, memberIds: string[]): Project {
  return {
    id,
    name: id.toUpperCase(),
    repoPath: "",
    createdAt: "",
    members: memberIds.map((agentId) => ({ agentId, access: "write" as const })),
    team: memberIds.map((agentId, i) => ({ role: `r${i}`, agentId })),
    mode: "local",
    forgeAccountId: null,
    forgeRepo: null,
    baseBranch: null,
    monitorIssues: false,
    rules: null,
  };
}

describe("buildWorld", () => {
  const agents = [
    agent("coo", "coo"),
    agent("p1-a", "agent"),
    agent("p1-b", "agent"),
    agent("solo", "agent"),
  ];
  const projects = [project("p1", ["p1-a", "p1-b"])];

  it("gives every non-subagent agent a desk slot", () => {
    const w = buildWorld(agents, projects);
    expect(Object.keys(w.deskOf).sort()).toEqual(["coo", "p1-a", "p1-b", "solo"]);
  });

  it("excludes subagents from desks", () => {
    const w = buildWorld([...agents, agent("sub", "subagent")], projects);
    expect(w.deskOf["sub"]).toBeUndefined();
  });

  it("creates a project room, a coo room, and an unassigned cluster", () => {
    const w = buildWorld(agents, projects);
    const kinds = w.rooms.map((r) => r.kind).sort();
    expect(kinds).toEqual(["coo", "project", "unassigned"]);
    const proj = w.rooms.find((r) => r.kind === "project")!;
    expect(proj.label).toBe("P1");
    expect(proj.whiteboard).toBeDefined();
  });

  it("marks each project room's door tile as DOOR and walkable from outside", () => {
    const w = buildWorld(agents, projects);
    const proj = w.rooms.find((r) => r.kind === "project")!;
    expect(w.grid[proj.doorTy * w.cols + proj.doorTx]).toBe(Cell.DOOR);
    // The tile just outside the door (below the bottom wall) is FLOOR.
    const below = (proj.doorTy + 1) * w.cols + proj.doorTx;
    expect(w.grid[below]).toBe(Cell.FLOOR);
  });

  it("marks desk tiles as DESK and keeps the chair tile walkable", () => {
    const w = buildWorld(agents, projects);
    const slot = w.deskOf["p1-a"];
    expect(w.grid[slot.deskTy * w.cols + slot.deskTx]).toBe(Cell.DESK);
    expect(w.grid[slot.chairTy * w.cols + slot.chairTx]).toBe(Cell.FLOOR);
  });

  it("returns positive pixel dimensions", () => {
    const w = buildWorld(agents, projects);
    expect(w.pxWidth).toBeGreaterThan(0);
    expect(w.pxHeight).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @otterbot/web test`
Expected: FAIL — `buildWorld` not found.

- [ ] **Step 3: Write `worldLayout.ts`**

```ts
import type { AgentProfileSummary } from "@otterbot/shared";
import type { Project } from "../../../stores/projects-store";
import { Cell, TILE } from "./geometry";

export interface DeskSlot {
  agentId: string;
  deskTx: number;
  deskTy: number;
  chairTx: number;
  chairTy: number;
}

export interface Room {
  id: string;
  label: string | null;
  kind: "coo" | "project" | "unassigned";
  /** Tile-space rect of the room's outer footprint (includes walls). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Door tile (on the bottom wall); -1/-1 for the wall-less unassigned area. */
  doorTx: number;
  doorTy: number;
  whiteboard?: { tx: number; ty: number; wTiles: number };
  desks: DeskSlot[];
}

export interface World {
  cols: number;
  rows: number;
  grid: Uint8Array;
  rooms: Room[];
  deskOf: Record<string, DeskSlot>;
  pxWidth: number;
  pxHeight: number;
}

// Desk cell: 2 tiles wide, 3 tall (desk tile on top, chair below it, 1 gap row).
const CELL_W = 2;
const CELL_H = 3;
const MAX_DESK_COLS = 4;
const ROOM_GAP = 2; // tiles between rooms
const ROW_GAP = 3; // tiles between room rows
const TARGET_COLS = 64; // soft wrap width in tiles

interface Cluster {
  id: string;
  label: string | null;
  kind: Room["kind"];
  members: AgentProfileSummary[];
}

function clusterDims(n: number, kind: Room["kind"]) {
  const deskCols = Math.min(Math.max(1, Math.ceil(Math.sqrt(n))), MAX_DESK_COLS);
  const deskRows = Math.ceil(n / deskCols);
  const wallless = kind === "unassigned";
  const titleRows = kind === "project" ? 1 : 0; // whiteboard row
  const border = wallless ? 0 : 1;
  const interiorW = deskCols * CELL_W;
  const interiorH = deskRows * CELL_H;
  return {
    deskCols,
    deskRows,
    border,
    titleRows,
    w: interiorW + border * 2,
    h: interiorH + titleRows + border * 2,
  };
}

export function buildWorld(agents: AgentProfileSummary[], projects: Project[]): World {
  const desk = agents.filter((a) => a.role !== "subagent");
  const coo = desk.find((a) => a.role === "coo") ?? null;

  const idSet = new Set(desk.map((a) => a.id));
  const projectOf = new Map<string, Project>();
  for (const p of projects)
    for (const m of p.members)
      if (idSet.has(m.agentId) && !projectOf.has(m.agentId)) projectOf.set(m.agentId, p);

  const byProject = new Map<string, AgentProfileSummary[]>();
  const standalone: AgentProfileSummary[] = [];
  for (const a of desk) {
    if (a.id === coo?.id) continue;
    const p = projectOf.get(a.id);
    if (p) {
      const list = byProject.get(p.id) ?? [];
      list.push(a);
      byProject.set(p.id, list);
    } else standalone.push(a);
  }

  const clusters: Cluster[] = [];
  if (coo) clusters.push({ id: "coo", label: "COO", kind: "coo", members: [coo] });
  for (const p of projects) {
    const members = byProject.get(p.id);
    if (!members?.length) continue;
    const order = new Map(p.team.map((t, i) => [t.agentId, i] as const));
    members.sort(
      (a, b) =>
        (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) ||
        a.displayName.localeCompare(b.displayName)
    );
    clusters.push({ id: p.id, label: p.name, kind: "project", members });
  }
  if (standalone.length) {
    standalone.sort((a, b) => a.displayName.localeCompare(b.displayName));
    clusters.push({ id: "unassigned", label: "Unassigned", kind: "unassigned", members: standalone });
  }

  // Flow clusters left→right, wrapping. Offset by 1 for the outer wall.
  type Placed = Cluster & { dims: ReturnType<typeof clusterDims>; x: number; y: number };
  const placed: Placed[] = [];
  let curX = 1;
  let rowY = 1;
  let rowMaxH = 0;
  for (const c of clusters) {
    const dims = clusterDims(c.members.length, c.kind);
    if (curX > 1 && curX + dims.w > TARGET_COLS) {
      curX = 1;
      rowY += rowMaxH + ROW_GAP;
      rowMaxH = 0;
    }
    placed.push({ ...c, dims, x: curX, y: rowY });
    curX += dims.w + ROOM_GAP;
    rowMaxH = Math.max(rowMaxH, dims.h);
  }

  const contentRight = placed.reduce((m, p) => Math.max(m, p.x + p.dims.w), 1);
  const contentBottom = placed.reduce((m, p) => Math.max(m, p.y + p.dims.h), 1);
  const cols = contentRight + 1; // +1 outer wall on the right
  const rows = contentBottom + 1;
  const grid = new Uint8Array(cols * rows).fill(Cell.FLOOR);
  const set = (tx: number, ty: number, v: Cell) => {
    if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) grid[ty * cols + tx] = v;
  };

  // Outer wall border.
  for (let tx = 0; tx < cols; tx++) {
    set(tx, 0, Cell.WALL);
    set(tx, rows - 1, Cell.WALL);
  }
  for (let ty = 0; ty < rows; ty++) {
    set(0, ty, Cell.WALL);
    set(cols - 1, ty, Cell.WALL);
  }

  const rooms: Room[] = [];
  const deskOf: Record<string, DeskSlot> = {};

  for (const p of placed) {
    const { x, y, dims } = p;
    const room: Room = {
      id: p.id,
      label: p.label,
      kind: p.kind,
      x,
      y,
      w: dims.w,
      h: dims.h,
      doorTx: -1,
      doorTy: -1,
      desks: [],
    };

    if (p.kind !== "unassigned") {
      // Walls around the room rect.
      for (let tx = x; tx < x + dims.w; tx++) {
        set(tx, y, Cell.WALL);
        set(tx, y + dims.h - 1, Cell.WALL);
      }
      for (let ty = y; ty < y + dims.h; ty++) {
        set(x, ty, Cell.WALL);
        set(x + dims.w - 1, ty, Cell.WALL);
      }
      // Door in the middle of the bottom wall.
      room.doorTx = x + Math.floor(dims.w / 2);
      room.doorTy = y + dims.h - 1;
      set(room.doorTx, room.doorTy, Cell.DOOR);
      if (p.kind === "project") {
        room.whiteboard = { tx: x + 1, ty: y + 1, wTiles: Math.max(2, dims.w - 2) };
      }
    }

    // Desks.
    const innerX = x + dims.border;
    const innerY = y + dims.border + dims.titleRows;
    p.members.forEach((m, i) => {
      const dc = i % dims.deskCols;
      const dr = Math.floor(i / dims.deskCols);
      const deskTx = innerX + dc * CELL_W;
      const deskTy = innerY + dr * CELL_H;
      const slot: DeskSlot = {
        agentId: m.id,
        deskTx,
        deskTy,
        chairTx: deskTx,
        chairTy: deskTy + 1,
      };
      set(deskTx, deskTy, Cell.DESK);
      // chair stays FLOOR (walkable)
      room.desks.push(slot);
      deskOf[m.id] = slot;
    });

    rooms.push(room);
  }

  return { cols, rows, grid, rooms, deskOf, pxWidth: cols * TILE, pxHeight: rows * TILE };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @otterbot/web test`
Expected: PASS (all `buildWorld` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/office/worldLayout.ts packages/web/src/components/agents/office/worldLayout.test.ts
git commit -m "Add office world layout (walled rooms + desks)"
```

---

## Task 3: pathfind (TDD)

**Files:**
- Create: `packages/web/src/components/agents/office/pathfind.ts`
- Test: `packages/web/src/components/agents/office/pathfind.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { findPath } from "./pathfind";
import { Cell } from "./geometry";
import type { World } from "./worldLayout";

// 5x5 world: wall border, a desk at (2,2), door at (2,4) bottom wall.
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
    // never steps on the desk or a wall
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @otterbot/web test`
Expected: FAIL — `findPath` not found.

- [ ] **Step 3: Write `pathfind.ts`**

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @otterbot/web test`
Expected: PASS (all `findPath` + `buildWorld` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/office/pathfind.ts packages/web/src/components/agents/office/pathfind.test.ts
git commit -m "Add office grid pathfinding"
```

---

## Task 4: tiles.ts — programmatic environment rendering

Draws the static environment into a single `Graphics` per layer. Pixel palette uses hardcoded hex (Pixi can't read CSS vars). The Kenney atlas overlay comes in Task 9; this is the always-correct baseline.

**Files:**
- Create: `packages/web/src/components/agents/office/tiles.ts`

- [ ] **Step 1: Write `tiles.ts`**

```ts
import { Container, Graphics } from "pixi.js";
import { Cell, TILE } from "./geometry";
import type { World } from "./worldLayout";

const C = {
  floor: 0x2b2f3a,
  floorAlt: 0x30343f,
  wall: 0x171a21,
  wallTop: 0x3a4254,
  door: 0x5a4636,
  deskTop: 0x6a513c,
  deskEdge: 0x3c2f24,
  plant: 0x3f8f5a,
  printer: 0xb9bec8,
};

/** Draw the floor + walls + doors + desks for a world into a fresh Container. */
export function drawEnvironment(world: World): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      const x = tx * TILE;
      const y = ty * TILE;
      switch (cell) {
        case Cell.WALL:
          g.rect(x, y, TILE, TILE).fill(C.wall);
          g.rect(x, y, TILE, 4).fill(C.wallTop);
          break;
        case Cell.DOOR:
          g.rect(x, y, TILE, TILE).fill(C.floor);
          g.rect(x + 3, y, TILE - 6, TILE).fill(C.door);
          break;
        case Cell.DESK:
          g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
          g.rect(x + 1, y + 3, TILE - 2, TILE - 5).fill(C.deskTop);
          g.rect(x + 1, y + TILE - 4, TILE - 2, 3).fill(C.deskEdge);
          break;
        default:
          g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
      }
    }
  }
  return root;
}

/** A simple potted-plant prop at a tile. */
export function drawPlant(tx: number, ty: number): Graphics {
  const g = new Graphics();
  g.rect(tx * TILE + 5, ty * TILE + 9, 6, 5).fill(0x8a5a3c);
  g.circle(tx * TILE + 8, ty * TILE + 6, 5).fill(C.plant);
  return g;
}

/** A simple printer prop at a tile. */
export function drawPrinter(tx: number, ty: number): Graphics {
  const g = new Graphics();
  g.rect(tx * TILE + 3, ty * TILE + 5, 10, 8).fill(C.printer);
  g.rect(tx * TILE + 5, ty * TILE + 3, 6, 3).fill(0x8b93a3);
  return g;
}
```

- [ ] **Step 2: Typecheck via build**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds (tiles imported nowhere yet is fine — esbuild tree-shakes; if the build complains about an unused file it won't, since it's not imported).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/office/tiles.ts
git commit -m "Add programmatic office tile rendering"
```

---

## Task 5: AgentToken.ts

One agent's on-floor token: avatar (or initials), status ring, a transient bubble, and frame-driven walking. The scene calls `update(dtMs)` each tick; `walkPath` resolves a promise when the token reaches the path end.

**Files:**
- Create: `packages/web/src/components/agents/office/AgentToken.ts`

- [ ] **Step 1: Write `AgentToken.ts`**

```ts
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { TILE, tilePx, type Pt } from "./geometry";
import type { AgentStatus } from "@otterbot/shared";

const STATUS_HEX: Record<AgentStatus, number> = {
  working: 0x46c46a,
  thinking: 0xe2b13c,
  waiting: 0x4aa3e0,
  error: 0xe0584a,
  stopped: 0x8b93a3,
  idle: 0x8b93a3,
};

const WALK_SPEED = 60 / 1000; // px per ms

export class AgentToken {
  readonly container = new Container();
  private ring = new Graphics();
  private bubble: Container | null = null;
  private bubbleTtl = 0;
  private path: Pt[] = [];
  private pathI = 0;
  private resolveWalk: (() => void) | null = null;
  private homeChair: Pt;
  private bobPhase = 0;
  reduced = false;

  constructor(
    readonly agentId: string,
    displayName: string,
    texture: Texture | null,
    chair: Pt
  ) {
    this.homeChair = chair;
    this.container.addChild(this.ring);

    const size = TILE + 6;
    if (texture) {
      const s = new Sprite(texture);
      s.width = size;
      s.height = size;
      s.anchor.set(0.5);
      this.container.addChild(s);
    } else {
      const chip = new Graphics().roundRect(-size / 2, -size / 2, size, size, 4).fill(0xc8cdd8);
      const initials = displayName.trim().slice(0, 2).toUpperCase() || "??";
      const t = new Text({ text: initials, style: { fontSize: 10, fill: 0x222222, fontWeight: "700" } });
      t.anchor.set(0.5);
      this.container.addChild(chip, t);
    }

    const label = new Text({
      text: displayName,
      style: { fontSize: 8, fill: 0xd7dbe4, align: "center" },
    });
    label.anchor.set(0.5, 0);
    label.y = size / 2 + 1;
    this.container.addChild(label);

    this.container.x = tilePx(chair.tx);
    this.container.y = tilePx(chair.ty);
    this.setStatus("idle");
  }

  setStatus(status: AgentStatus): void {
    const color = STATUS_HEX[status];
    const size = TILE + 6;
    this.ring.clear().roundRect(-size / 2 - 2, -size / 2 - 2, size + 4, size + 4, 6).stroke({ width: 2, color });
  }

  showBubble(text: string, accent: number): void {
    if (this.bubble) {
      this.container.removeChild(this.bubble);
      this.bubble.destroy();
    }
    const b = new Container();
    const msg = text.length > 42 ? text.slice(0, 42) + "…" : text;
    const t = new Text({ text: msg, style: { fontSize: 8, fill: 0x20242c, wordWrap: true, wordWrapWidth: 120 } });
    const padX = 5;
    const padY = 3;
    const bg = new Graphics()
      .roundRect(-padX, -padY, t.width + padX * 2, t.height + padY * 2, 4)
      .fill(0xe9ead2)
      .stroke({ width: 1, color: accent });
    b.addChild(bg, t);
    b.x = -t.width / 2;
    b.y = -(TILE + 6) / 2 - t.height - 10;
    this.container.addChild(b);
    this.bubble = b;
    this.bubbleTtl = 3500;
  }

  /** Begin walking along a tile path. Resolves when the token arrives. */
  walkPath(path: Pt[]): Promise<void> {
    if (this.reduced || path.length < 2) {
      const end = path[path.length - 1] ?? this.homeChair;
      this.container.x = tilePx(end.tx);
      this.container.y = tilePx(end.ty);
      return Promise.resolve();
    }
    this.path = path;
    this.pathI = 1;
    return new Promise((res) => (this.resolveWalk = res));
  }

  walkHome(path: Pt[]): Promise<void> {
    return this.walkPath(path);
  }

  isWalking(): boolean {
    return this.path.length > 0;
  }

  /** Advance animation by dtMs. Called from the scene ticker. */
  update(dtMs: number): void {
    // Bubble lifetime.
    if (this.bubble) {
      this.bubbleTtl -= dtMs;
      if (this.bubbleTtl <= 0) {
        this.container.removeChild(this.bubble);
        this.bubble.destroy();
        this.bubble = null;
      }
    }

    if (this.path.length > 0) {
      const target = this.path[this.pathI];
      const tx = tilePx(target.tx);
      const ty = tilePx(target.ty);
      const dx = tx - this.container.x;
      const dy = ty - this.container.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dtMs;
      if (dist <= step) {
        this.container.x = tx;
        this.container.y = ty;
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = [];
          this.pathI = 0;
          const r = this.resolveWalk;
          this.resolveWalk = null;
          r?.();
        }
      } else {
        this.container.x += (dx / dist) * step;
        this.container.y += (dy / dist) * step;
      }
      return;
    }

    // Idle bob when at rest and not reduced-motion.
    if (!this.reduced) {
      this.bobPhase += dtMs / 600;
      this.container.y = tilePx(this.homeChair.ty) + Math.sin(this.bobPhase) * 1.2;
    }
  }

  setHome(chair: Pt): void {
    this.homeChair = chair;
  }

  homePath(): Pt {
    return this.homeChair;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
```

- [ ] **Step 2: Typecheck via build**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/office/AgentToken.ts
git commit -m "Add office agent token (avatar, status, bubble, walk)"
```

---

## Task 6: whiteboard.ts

Renders a project's latest pipeline run as a row of stage chips + the goal text, sized to the room's whiteboard strip.

**Files:**
- Create: `packages/web/src/components/agents/office/whiteboard.ts`

- [ ] **Step 1: Write `whiteboard.ts`**

```ts
import { Container, Graphics, Text } from "pixi.js";
import { TILE } from "./geometry";
import type { PipelineRun } from "../../../stores/projects-store";

const STAGE_HEX: Record<string, number> = {
  pass: 0x46c46a,
  fail: 0xe0584a,
  error: 0xe0584a,
  running: 0xe2b13c,
  pending: 0x8b93a3,
};

/** Build a whiteboard graphic for a room's whiteboard strip (tile coords). */
export function drawWhiteboard(
  tx: number,
  ty: number,
  wTiles: number,
  run: PipelineRun | null
): Container {
  const root = new Container();
  const w = wTiles * TILE;
  const h = TILE - 2;
  root.x = tx * TILE;
  root.y = ty * TILE + 1;

  const bg = new Graphics().roundRect(0, 0, w, h, 2).fill(0xe9ead2).stroke({ width: 1, color: 0x11141a });
  root.addChild(bg);

  if (!run) {
    const t = new Text({ text: "No runs yet", style: { fontSize: 7, fill: 0x6a6a55 } });
    t.x = 4;
    t.y = h / 2 - 4;
    root.addChild(t);
    return root;
  }

  const goal = run.goal.length > 22 ? run.goal.slice(0, 22) + "…" : run.goal;
  const title = new Text({ text: goal, style: { fontSize: 7, fill: 0x3a3a2a, fontWeight: "700" } });
  title.x = 4;
  title.y = 2;
  root.addChild(title);

  let cx = 4;
  for (const st of run.stages) {
    const color = STAGE_HEX[st.status] ?? STAGE_HEX.pending;
    const dot = new Graphics().circle(cx + 3, h - 5, 3).fill(color);
    root.addChild(dot);
    cx += 9;
  }
  return root;
}
```

- [ ] **Step 2: Typecheck via build**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/office/whiteboard.ts
git commit -m "Add office pipeline whiteboard"
```

---

## Task 7: OfficeScene.ts

Owns the Pixi stage, the world `Container` (scaled to fit), the layer Containers, the token pool, and the ticker that drives all animation. Public methods are the only surface `PixiOffice` touches.

**Files:**
- Create: `packages/web/src/components/agents/office/OfficeScene.ts`

- [ ] **Step 1: Write `OfficeScene.ts`**

```ts
import { Application, Assets, Container, Graphics, Text, Texture } from "pixi.js";
import type { AgentMessage, AgentMsgKind, AgentProfileSummary, AgentStatus } from "@otterbot/shared";
import type { PipelineRun, Project } from "../../../stores/projects-store";
import { withToken } from "../../../lib/api";
import { Cell, TILE, tilePx, type Pt } from "./geometry";
import { buildWorld, type World } from "./worldLayout";
import { findPath } from "./pathfind";
import { drawEnvironment, drawPlant, drawPrinter } from "./tiles";
import { AgentToken } from "./AgentToken";
import { drawWhiteboard } from "./whiteboard";

const KIND_ACCENT: Partial<Record<AgentMsgKind, number>> = {
  request: 0x4aa3e0,
  response: 0x46c46a,
  spawn: 0xe2b13c,
  report: 0x46c46a,
  broadcast: 0x8a7ce0,
};
const WALK_KINDS: Set<AgentMsgKind> = new Set(["request", "response", "spawn", "report"]);
const MAX_WALKERS = 6;

export class OfficeScene {
  private root = new Container();
  private envLayer = new Container();
  private boardLayer = new Container();
  private tokenLayer = new Container();
  private ambianceLayer = new Container();
  private tokens = new Map<string, AgentToken>();
  private boards = new Map<string, { container: Container; tx: number; ty: number; wTiles: number }>();
  private textures = new Map<string, Texture | null>();
  private world: World | null = null;
  private structureKey = "";
  private reduced = false;
  private clock: Text | null = null;
  private containerW = 800;
  private containerH = 600;

  constructor(private app: Application) {
    this.root.addChild(this.envLayer, this.boardLayer, this.tokenLayer, this.ambianceLayer);
    this.app.stage.addChild(this.root);
    this.app.ticker.add(this.onTick);
  }

  private onTick = () => {
    const dt = this.app.ticker.deltaMS;
    for (const tok of this.tokens.values()) tok.update(dt);
  };

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    for (const tok of this.tokens.values()) tok.reduced = reduced;
  }

  resize(w: number, h: number): void {
    this.containerW = w;
    this.containerH = h;
    this.fit();
  }

  private fit(): void {
    if (!this.world) return;
    const scale = Math.min(
      this.containerW / this.world.pxWidth,
      this.containerH / this.world.pxHeight
    );
    const s = Math.max(0.2, Math.min(scale, 3));
    this.root.scale.set(s);
    this.root.x = (this.containerW - this.world.pxWidth * s) / 2;
    this.root.y = (this.containerH - this.world.pxHeight * s) / 2;
  }

  /** Rebuild rooms only when the agent/project structure changes. */
  async setWorld(agents: AgentProfileSummary[], projects: Project[]): Promise<void> {
    const key =
      agents.filter((a) => a.role !== "subagent").map((a) => a.id).sort().join(",") +
      "|" +
      projects.map((p) => `${p.id}:${p.members.map((m) => m.agentId).sort().join(",")}`).join(";");
    if (key === this.structureKey && this.world) {
      // Same structure: refresh statuses only.
      for (const a of agents) this.tokens.get(a.id)?.setStatus(a.status);
      return;
    }
    this.structureKey = key;
    const world = buildWorld(agents, projects);
    this.world = world;

    // Environment.
    this.envLayer.removeChildren().forEach((c) => c.destroy());
    this.envLayer.addChild(drawEnvironment(world));
    // A couple of props on open floor near the bottom-right.
    this.envLayer.addChild(drawPlant(1, world.rows - 2), drawPrinter(world.cols - 3, world.rows - 2));

    // Whiteboards.
    this.boardLayer.removeChildren().forEach((c) => c.destroy());
    this.boards.clear();
    for (const room of world.rooms) {
      if (room.kind !== "project" || !room.whiteboard) continue;
      const wb = drawWhiteboard(room.whiteboard.tx, room.whiteboard.ty, room.whiteboard.wTiles, null);
      this.boardLayer.addChild(wb);
      this.boards.set(room.id, { container: wb, ...room.whiteboard });
    }

    // Tokens: load avatar textures, then create/reposition (pool by id).
    const byId = new Map(agents.map((a) => [a.id, a]));
    const wantIds = new Set(Object.keys(world.deskOf));

    // Remove tokens for agents that left.
    for (const [id, tok] of this.tokens) {
      if (!wantIds.has(id)) {
        tok.destroy();
        this.tokens.delete(id);
      }
    }

    for (const id of wantIds) {
      const a = byId.get(id)!;
      const slot = world.deskOf[id];
      const chair: Pt = { tx: slot.chairTx, ty: slot.chairTy };
      let tok = this.tokens.get(id);
      if (!tok) {
        const tex = await this.textureFor(a);
        tok = new AgentToken(id, a.displayName, tex, chair);
        tok.reduced = this.reduced;
        this.tokens.set(id, tok);
        this.tokenLayer.addChild(tok.container);
      } else {
        tok.setHome(chair);
        tok.container.x = tilePx(chair.tx);
        tok.container.y = tilePx(chair.ty);
      }
      tok.setStatus(a.status);
    }

    this.ensureAmbiance();
    this.fit();
  }

  private async textureFor(a: AgentProfileSummary): Promise<Texture | null> {
    const url = a.artwork.avatar;
    if (!url) return null;
    if (this.textures.has(url)) return this.textures.get(url)!;
    try {
      const tex = (await Assets.load(withToken(url))) as Texture;
      this.textures.set(url, tex);
      return tex;
    } catch {
      this.textures.set(url, null);
      return null;
    }
  }

  setStatus(agentId: string, status: AgentStatus): void {
    this.tokens.get(agentId)?.setStatus(status);
  }

  setPipeline(projectId: string, run: PipelineRun | null): void {
    const entry = this.boards.get(projectId);
    if (!entry) return;
    const next = drawWhiteboard(entry.tx, entry.ty, entry.wTiles, run);
    this.boardLayer.removeChild(entry.container);
    entry.container.destroy({ children: true });
    this.boardLayer.addChild(next);
    this.boards.set(projectId, { ...entry, container: next });
  }

  onMessage(msg: AgentMessage): void {
    if (!this.world) return;
    const accent = KIND_ACCENT[msg.kind] ?? 0x8b93a3;
    const sender = this.tokens.get(msg.from);
    if (sender && msg.body) sender.showBubble(msg.body, accent);

    if (!WALK_KINDS.has(msg.kind)) return;
    if (!msg.to) return; // broadcast: bubble only, no mass walking
    const walkers = [...this.tokens.values()].filter((t) => t.isWalking()).length;
    if (walkers >= MAX_WALKERS) return;

    const fromSlot = this.world.deskOf[msg.from];
    const toSlot = this.world.deskOf[msg.to];
    if (!fromSlot || !toSlot || !sender) return;

    const start: Pt = { tx: fromSlot.chairTx, ty: fromSlot.chairTy };
    // Stand on a walkable tile adjacent to the recipient's chair.
    const goal = this.adjacentFloor({ tx: toSlot.chairTx, ty: toSlot.chairTy }) ?? start;
    const there = findPath(this.world, start, goal);
    if (there.length < 2) return;
    void sender.walkPath(there).then(() => {
      const back = findPath(this.world!, goal, start);
      if (back.length >= 2) void sender.walkHome(back);
    });
  }

  private adjacentFloor(p: Pt): Pt | null {
    if (!this.world) return null;
    const { cols, rows, grid } = this.world;
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = p.tx + dx;
      const ny = p.ty + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const c = grid[ny * cols + nx] as Cell;
      if (c === Cell.FLOOR || c === Cell.DOOR) return { tx: nx, ty: ny };
    }
    return null;
  }

  private ensureAmbiance(): void {
    if (!this.world) return;
    this.ambianceLayer.removeChildren().forEach((c) => c.destroy());
    // Window strip across the top inner wall, tinted by local time.
    const hour = new Date().getHours();
    const day = hour >= 7 && hour < 19;
    const sky = day ? 0x7fb0d6 : 0x2a3550;
    const win = new Graphics().rect(TILE, 2, this.world.pxWidth - TILE * 2, 6).fill(sky);
    this.ambianceLayer.addChild(win);
    // Wall clock.
    const hh = String(hour).padStart(2, "0");
    const mm = String(new Date().getMinutes()).padStart(2, "0");
    this.clock = new Text({ text: `${hh}:${mm}`, style: { fontSize: 8, fill: 0xd7dbe4 } });
    this.clock.x = this.world.pxWidth - 34;
    this.clock.y = 9;
    this.ambianceLayer.addChild(this.clock);
  }

  destroy(): void {
    this.app.ticker.remove(this.onTick);
    for (const tok of this.tokens.values()) tok.destroy();
    this.tokens.clear();
    this.root.destroy({ children: true });
  }
}
```

- [ ] **Step 2: Typecheck via build**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/agents/office/OfficeScene.ts
git commit -m "Add OfficeScene controller (layers, tokens, ticker, events)"
```

---

## Task 8: PixiOffice.tsx + wire into NetworkView + remove DOM office

**Files:**
- Create: `packages/web/src/components/agents/office/PixiOffice.tsx`
- Modify: `packages/web/src/components/agents/NetworkView.tsx`
- Delete: `packages/web/src/components/agents/AgentOffice.tsx`, `packages/web/src/components/agents/office-layout.ts`

- [ ] **Step 1: Write `PixiOffice.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { useAgentsStore } from "../../../stores/agents-store";
import { useActivityStore } from "../../../stores/activity-store";
import { useProjectsStore } from "../../../stores/projects-store";
import { type } from "../../../lib/typography";
import { OfficeScene } from "./OfficeScene";

/**
 * The Office sub-tab: a PixiJS pixel-art office. A single Pixi Application is
 * created here; we subscribe to the Zustand stores with their vanilla
 * `.subscribe()` so Socket.IO traffic drives the scene imperatively without
 * re-rendering React.
 */
export function PixiOffice() {
  const hostRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let scene: OfficeScene | null = null;
    let app: Application | null = null;
    let ro: ResizeObserver | null = null;
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    // Ensure data is flowing.
    const agentsStore = useAgentsStore.getState();
    const activityStore = useActivityStore.getState();
    const projectsStore = useProjectsStore.getState();
    agentsStore.bindSocket();
    void agentsStore.load();
    activityStore.bindSocket();
    void activityStore.load();
    projectsStore.bindSocket();
    void projectsStore.load();

    (async () => {
      app = new Application();
      try {
        await app.init({
          resizeTo: host,
          antialias: false,
          backgroundColor: 0x1a1c22,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
      } catch {
        if (errorRef.current) errorRef.current.style.display = "flex";
        return;
      }
      if (cancelled) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      scene = new OfficeScene(app);

      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      scene.setReducedMotion(mql.matches);
      const onMql = () => scene?.setReducedMotion(mql.matches);
      mql.addEventListener("change", onMql);
      unsubs.push(() => mql.removeEventListener("change", onMql));

      ro = new ResizeObserver(() => scene?.resize(host.clientWidth, host.clientHeight));
      ro.observe(host);
      scene.resize(host.clientWidth, host.clientHeight);

      // Initial world + load pipeline runs for each project.
      const a0 = useAgentsStore.getState().agents;
      const p0 = useProjectsStore.getState().projects;
      void scene.setWorld(a0, p0);
      for (const p of p0) void useProjectsStore.getState().loadRuns(p.id);

      // Subscriptions (outside React render).
      let lastAgents = a0;
      unsubs.push(
        useAgentsStore.subscribe((s) => {
          if (s.agents === lastAgents) return;
          const prev = new Map(lastAgents.map((a) => [a.id, a.status]));
          lastAgents = s.agents;
          void scene?.setWorld(s.agents, useProjectsStore.getState().projects);
          for (const a of s.agents) if (prev.get(a.id) !== a.status) scene?.setStatus(a.id, a.status);
        })
      );

      let lastProjects = p0;
      unsubs.push(
        useProjectsStore.subscribe((s) => {
          if (s.projects !== lastProjects) {
            lastProjects = s.projects;
            void scene?.setWorld(useAgentsStore.getState().agents, s.projects);
          }
          // Push the latest run per project to its whiteboard.
          for (const [pid, runs] of Object.entries(s.runs)) {
            scene?.setPipeline(pid, runs[0] ?? null);
          }
        })
      );

      let lastSeq = -1;
      const seedSeq = () => {
        const msgs = useActivityStore.getState().messages;
        lastSeq = msgs.length ? msgs[msgs.length - 1].seq : -1;
      };
      seedSeq();
      unsubs.push(
        useActivityStore.subscribe((s) => {
          const msgs = s.messages;
          if (!msgs.length) return;
          const fresh = msgs.filter((m) => m.seq > lastSeq);
          lastSeq = msgs[msgs.length - 1].seq;
          for (const m of fresh) scene?.onMessage(m);
        })
      );
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      for (const u of unsubs) u();
      scene?.destroy();
      app?.destroy(true);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div
        ref={errorRef}
        style={{
          display: "none",
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          color: "rgb(var(--muted))",
          ...type.body,
        }}
      >
        The office view needs WebGL, which isn't available in this browser.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Point NetworkView at PixiOffice**

In `packages/web/src/components/agents/NetworkView.tsx`, replace the import:
```tsx
import { AgentOffice } from "./AgentOffice";
```
with:
```tsx
import { PixiOffice } from "./office/PixiOffice";
```
and the render:
```tsx
{tab === "office" && <AgentOffice />}
```
with:
```tsx
{tab === "office" && <PixiOffice />}
```

- [ ] **Step 3: Delete the DOM office**

Run:
```bash
git rm packages/web/src/components/agents/AgentOffice.tsx packages/web/src/components/agents/office-layout.ts
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds with no references to the deleted files.

- [ ] **Step 5: Run unit tests (regression)**

Run: `pnpm --filter @otterbot/web test`
Expected: PASS (worldLayout + pathfind).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/agents/office/PixiOffice.tsx packages/web/src/components/agents/NetworkView.tsx
git commit -m "Render PixiJS office in Network view, remove DOM office"
```

---

## Task 9: Playwright smoke test

**Files:**
- Create: `packages/web/e2e/05-office.spec.ts`

- [ ] **Step 1: Read an existing spec for the harness pattern**

Read `packages/web/e2e/01-shell.spec.ts` and `packages/web/e2e/helpers.ts` to reuse login/onboarding helpers and the `view-network` testid (App.tsx nav buttons use `data-testid="view-<id>"`).

- [ ] **Step 2: Write the smoke test**

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers"; // use whatever the other specs import; adjust to match

test("office sub-tab mounts a pixi canvas with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await gotoApp(page); // reuse the existing helper that lands on the authed app
  await page.getByTestId("view-network").click();
  await page.getByRole("button", { name: "Office" }).click();

  const canvas = page.locator("canvas");
  await expect(canvas.first()).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
```

Note: match the exact import/helper name used by the sibling specs (Step 1). If the office tab button isn't found by name, fall back to a `data-testid` — add `data-testid="network-subtab-office"` to the Office tab button in `Tabs.tsx`'s consumer if needed, but prefer the role/name selector first.

- [ ] **Step 3: Run the smoke test**

Run: `pnpm --filter @otterbot/web test:e2e -- 05-office`
Expected: PASS (canvas visible, zero console errors).

- [ ] **Step 4: Commit**

```bash
git add packages/web/e2e/05-office.spec.ts
git commit -m "Add Playwright smoke test for the office tab"
```

---

## Task 10: Kenney CC0 furniture atlas overlay

Layers a Kenney CC0 spritesheet over the `Graphics` baseline. The baseline already renders everything, so this is purely an upgrade — any tile without a chosen sprite keeps its `Graphics` drawing.

Pack: **Kenney "Roguelike Modern City"** (CC0) — top-down modern tiles incl. furniture. https://kenney.nl/assets/roguelike-modern-city

**Files:**
- Create: `packages/web/public/office/` (the downloaded spritesheet PNG + its XML atlas)
- Modify: `packages/web/src/components/agents/office/tiles.ts`

- [ ] **Step 1: Download the pack and place the spritesheet**

Download the pack from the URL above (CC0 — no attribution required, but keep the bundled `License.txt`). From its `Spritesheet/` folder copy the packed sheet + XML to:
```
packages/web/public/office/roguelike.png
packages/web/public/office/roguelike.xml
```
Kenney's XML is `<TextureAtlas imagePath="..."><SubTexture name="..." x=".." y=".." width=".." height=".."/>…`.

- [ ] **Step 2: Open the pack preview and pick sprite names**

Open the pack's preview image. Note the `name` attribute (from the XML) of the sprites you want for: floor, wall, door, desk, plant, printer, window. Record them in the `ART` map below (Step 3). If you can't find a good sprite for a given item, leave it out — the `Graphics` fallback covers it.

- [ ] **Step 3: Add an atlas loader + lookup to `tiles.ts`**

Add to the top of `tiles.ts`:
```ts
import { Assets, Rectangle, Sprite, Texture } from "pixi.js";

// Sprite names from public/office/roguelike.xml, chosen in Step 2.
// Leave a value undefined to keep the Graphics drawing for that item.
const ART: Partial<Record<"floor" | "wall" | "door" | "desk" | "plant" | "printer", string>> = {
  // e.g. floor: "tile_0000.png", wall: "tile_0012.png", desk: "tile_0420.png",
};

let sheet: Texture | null = null;
let frames: Record<string, Rectangle> | null = null;

/** Load the Kenney sheet + parse its XML atlas. Safe to call repeatedly. */
export async function loadOfficeAtlas(): Promise<void> {
  if (frames) return;
  try {
    sheet = (await Assets.load("/office/roguelike.png")) as Texture;
    const xml = await (await fetch("/office/roguelike.xml")).text();
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const out: Record<string, Rectangle> = {};
    doc.querySelectorAll("SubTexture").forEach((el) => {
      const name = el.getAttribute("name")!;
      out[name] = new Rectangle(
        +el.getAttribute("x")!,
        +el.getAttribute("y")!,
        +el.getAttribute("width")!,
        +el.getAttribute("height")!
      );
    });
    frames = out;
  } catch {
    frames = {}; // atlas unavailable → Graphics fallback everywhere
  }
}

/** A Sprite for an art key if it's mapped and loaded; else null (use Graphics). */
export function artSprite(key: keyof typeof ART): Sprite | null {
  const name = ART[key];
  if (!name || !sheet || !frames || !frames[name]) return null;
  const tex = new Texture({ source: sheet.source, frame: frames[name] });
  const s = new Sprite(tex);
  s.width = TILE;
  s.height = TILE;
  return s;
}
```

- [ ] **Step 4: Use sprites in `drawEnvironment` where available**

In `drawEnvironment`, for each tile, before drawing the `Graphics` primitive, try the atlas sprite and add it instead:
```ts
// inside the per-tile switch, e.g. for DESK:
case Cell.DESK: {
  const base = artSprite("floor");
  if (base) { base.x = x; base.y = y; root.addChild(base); }
  else { g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt); }
  const deskSprite = artSprite("desk");
  if (deskSprite) { deskSprite.x = x; deskSprite.y = y; root.addChild(deskSprite); }
  else {
    g.rect(x + 1, y + 3, TILE - 2, TILE - 5).fill(C.deskTop);
    g.rect(x + 1, y + TILE - 4, TILE - 2, 3).fill(C.deskEdge);
  }
  break;
}
```
Apply the same pattern (sprite-if-available, else Graphics) to WALL, DOOR, and the floor default. Keep the existing `Graphics` blocks as the `else` branches verbatim.

- [ ] **Step 5: Call the atlas loader before building the world**

In `OfficeScene.setWorld`, before `drawEnvironment(world)`, await the loader once:
```ts
import { drawEnvironment, drawPlant, drawPrinter, loadOfficeAtlas } from "./tiles";
// ...
await loadOfficeAtlas();
this.envLayer.addChild(drawEnvironment(world));
```

- [ ] **Step 6: Build + manual check**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds. Then verify in the app (Task 11) that mapped tiles show sprites and unmapped ones still render via Graphics.

- [ ] **Step 7: Commit**

```bash
git add packages/web/public/office packages/web/src/components/agents/office/tiles.ts packages/web/src/components/agents/office/OfficeScene.ts
git commit -m "Overlay Kenney CC0 furniture atlas with Graphics fallback"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Start the app**

Run: `pnpm dev` (server + web). Open the web URL.

- [ ] **Step 2: Open the office**

Network tab → **Office** sub-tab. Expected: a top-down office; the COO room, one walled room per project (desks + a whiteboard), and an open "Unassigned" cluster; each agent shows its avatar (or initials) with a status ring; a window strip + clock.

- [ ] **Step 3: Trigger activity**

Chat with the COO and ask it to delegate to / spawn for a project agent (or start a project pipeline). Expected: the sender's token walks out its door, through the corridor, to the recipient and back; a speech bubble appears; status rings change color live; on a pipeline run the project room's whiteboard shows stage dots.

- [ ] **Step 4: Resize + reduced motion**

Resize the window — the office re-fits (camera scale) without errors. Toggle OS "reduce motion" — tokens stop walking/bobbing (teleport) while still showing status + bubbles.

- [ ] **Step 5: Tab switch teardown**

Switch to the Permissions sub-tab and back. Expected: no console errors; the canvas is recreated cleanly (the effect cleanup destroyed the prior app).

- [ ] **Step 6: Final build + tests**

Run:
```bash
pnpm --filter @otterbot/web build
pnpm --filter @otterbot/web test
```
Expected: both pass.

---

## Self-Review notes (for the implementer)

- **Spec coverage:** walled rooms + COO + unassigned (Task 2); door-routed walking (Tasks 3, 7); avatar tokens + status + bubbles (Task 5); per-room pipeline whiteboards (Tasks 6, 7); ambiance window/clock/props (Tasks 4, 7); CC0 pack + Graphics fallback (Tasks 4, 10); replaces DOM office (Task 8); reduced-motion + WebGL handling (Tasks 7, 8); vitest unit tests + Playwright smoke (Tasks 0, 2, 3, 9).
- **Pixi v8 API to confirm while implementing:** `Application.init()` is async; `Graphics` uses the chained `.rect().fill()` / `.stroke({width,color})` API; `Text` takes `{ text, style }`; `Texture` sub-framing via `new Texture({ source, frame })`. If the installed Pixi minor differs, adjust these calls — the structure is unaffected.
- **Subagents:** v1 represents activity via bubbles + walks between desked (non-subagent) agents. Transient subagent tokens are intentionally out of v1 scope (spec non-goal: no walk-cycle sprites); revisit later if desired.
