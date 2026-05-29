# PixiJS Pixel-Art Office — Design

**Date:** 2026-05-29
**Status:** Approved (design); pending implementation plan
**Area:** `packages/web` — Network view → Office sub-tab

## Context

The Network view has two sub-tabs: **Permissions** (an editable peer-access graph)
and **Office** (a lightweight DOM/CSS scene of agents at desks, grouped into project
"rooms," with status animation and message envelopes). After seeing
[paulrobello/claude-office](https://github.com/paulrobello/claude-office) — a real-time
pixel-art office simulation for Claude Code (Next.js + PixiJS, animated sprite
characters, movement, bubbles, whiteboards) — the user chose to **pivot the Office
sub-tab to a PixiJS pixel-art simulation** in that spirit.

All the live data already exists in Otterbot and flows through Zustand stores fed by
Socket.IO: agent status (`agent:status`), agent-to-agent bus traffic (`bus:message`),
subagent tasks, projects, and pipeline runs (`pipeline:update`). This is purely a
front-end visualization change; no server changes.

## Goal

Replace the DOM Office sub-tab with a top-down, walled-room pixel-art office where each
agent is a character (its avatar) at a desk, project teams occupy walled rooms, the COO
presides, and live activity animates the scene: characters **walk** between rooms when
they delegate/spawn, **speech/thought bubbles** show what they're doing, per-room
**whiteboards** show pipeline status, and ambient props (window day/night, clock, plant,
printer) give it life.

## Non-goals

- No server/back-end changes; no new socket events.
- No per-agent walk-cycle spritesheets — characters are the existing avatar images on a
  token, not animated multi-frame sprites.
- No multi-floor building (claude-office has floors; v1 is a single floor).
- The Permissions sub-tab is unchanged.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Renderer / integration | **Imperative PixiJS v8 `Application` + Zustand store bridge** (subscribe outside React render). |
| Characters | **Existing agent avatars** as token faces (initials fallback). |
| Environment furniture | **CC0 pack** (pinned below) with **programmatic Pixi `Graphics`** fallback; abstracted behind `tiles.ts`. |
| Floor arrangement | **Walled rooms** per project + COO office + open "Unassigned" area, linked by a corridor. |
| v1 behaviors | Walking movement, speech/thought bubbles, per-room whiteboard, ambient props. |
| DOM office | **Removed** and replaced by the Pixi office. |
| Unit tests | **Add vitest to `packages/web`** for the pure modules. |

## Architecture

New dependency: `pixi.js` (v8) in `packages/web`. New dev dependency: `vitest` (+ config).

New directory `packages/web/src/components/agents/office/`:

- **`PixiOffice.tsx`** — React wrapper; the Office sub-tab. Creates one Pixi
  `Application`, sizes it with a `ResizeObserver`, appends the canvas. On mount it
  ensures data flows (agents `bindSocket`/`load`; activity `bindSocket`/`load`; projects
  `load` + `bindSocket`; `loadRuns` per project) and subscribes to the three stores via
  their **vanilla `.subscribe()`** (so socket churn never re-renders React). It diffs
  store snapshots and calls `OfficeScene` methods. On unmount (tab switch — `NetworkView`
  mounts sub-tabs conditionally) it destroys the app, ticker, and store subscriptions.
- **`OfficeScene.ts`** — owns the Pixi stage. Layers in z-order: `floor → walls →
  furniture → whiteboards → tokens → bubbles → fx → ambiance`. Public API:
  `setWorld(agents, projects)`, `setStatus(id, status)`, `onMessage(msg)`,
  `setPipeline(projectId, run)`, `resize(w, h)`, `setReducedMotion(bool)`, `destroy()`.
- **`worldLayout.ts`** *(pure, unit-tested)* — from agents + projects, computes the
  building: a room per project, a COO office, and an open "Unassigned" area, each with a
  rect, door tile(s), desk slots assigned to agents (keyed by immutable agent id, reusing
  the existing project-grouping logic), and a whiteboard spot — plus a **tile grid**
  (floor / wall / door / desk) for pathfinding. Returns world dimensions for camera fit.
- **`pathfind.ts`** *(pure, unit-tested)* — grid BFS/A\* over the tile grid; returns a
  waypoint path between two tiles, routing through doors. Blocks on walls/desks.
- **`AgentToken.ts`** — a `Container`: avatar `Sprite` (texture via `Assets.load`,
  initials `Text` fallback on a colored chip), status ring, name label, bubble anchor.
  Methods: `walkPath(path)`, `setStatus(status)`, `showBubble(text, kind)`, `idle()`.
- **`tiles.ts`** — environment rendering. v1 ships with programmatic `Graphics` tiles in
  a pixel palette (floor, wall, door, desk, whiteboard, plant, printer, window); if a CC0
  texture atlas is wired, it draws from that instead. The scene calls `tiles.*` and never
  knows which backend is active.
- **`whiteboard.ts`** — renders a project's latest pipeline run as stage chips
  (build ▸ review ▸ test) colored by running/pass/fail, plus the run goal.

### Data flow

```
Socket.IO → Zustand stores (agents / activity / projects)
          → PixiOffice .subscribe() diff
          → OfficeScene methods
          → Pixi ticker animation
```

Rooms rebuild (`setWorld`) only when the **structure** changes (agents added/removed or
project membership changes — detected with the same `structureKey` string the DOM office
used). Status, messages, and pipeline updates are applied incrementally without a rebuild.

## World layout model (`worldLayout.ts`)

- World space is a tile grid (≈16px tiles), camera-scaled to fit the container.
- An outer wall borders the floor. Rooms flow left→right and wrap, mirroring the DOM
  office grouping but rendered as walled rooms.
- **COO office:** a dedicated small room with a single desk.
- **Per project:** a walled room sized to its team (desks in a grid inside), exactly one
  **door** on the corridor-facing wall, and a **whiteboard** on an interior wall.
  Members ordered by team-role order then name (same as roster/graph).
- **Unassigned:** an open area (partial/no walls) holding standalone agents + props.
- **Corridor:** walkable floor connecting every door, so pathfinding routes
  room → door → corridor → door → room.
- Each agent gets a **desk tile** (blocked) + an adjacent **chair tile** (walkable, the
  token's home). Tile tags: wall/desk block; door/corridor/chair/floor walk.
- Agent→desk assignment is stable across status ticks (keyed by id).

## Movement (`pathfind.ts` + `AgentToken.walkPath`)

- **Idle:** token rests on its chair tile with a gentle bob.
- **Delegate / request / spawn (A→B):** A walks chair → its door → corridor → B's door →
  beside B, pauses for a bubble exchange, then walks home. Path from A\* through doors.
- **spawn:** a subagent token pops at the parent's desk and walks to a free spot in the
  parent's room; on `report`/done it walks to the door and fades out.
- **broadcast (COO → all):** no mass walking — a COO bubble + a ripple effect, to avoid
  chaos.
- **Concurrency cap:** ~6 simultaneous walkers; beyond that, just update status (no walk).
- All movement is tweened on the Pixi ticker. Reduced motion → teleport instead of walk.

## Visuals

- **Tokens:** avatar in a pixel-outlined pawn; status ring colored via the existing
  `statusColor` mapping; name label. Per-status cue: working = desk glow / "typing",
  thinking = amber + "…" thought bubble, waiting = blue, error = red shake, stopped =
  greyed, idle = neutral.
- **Bubbles:** speech bubble with the truncated message body for
  request/response/spawn/report; thought bubble for thinking/working. Auto-dismiss after a
  few seconds; concurrent bubbles capped.
- **Whiteboard (per room):** the project's latest pipeline run as stage chips colored by
  running/pass/fail + the goal, from `projects-store.runs[projectId]` (`loadRuns` +
  `pipeline:update`). "No runs yet" when empty.
- **Ambiance:** a window strip tinted by local time (day/night), a wall clock, and props
  (plant, printer). Minimal but present in v1.

## Asset strategy

- **Characters:** existing avatars — `Assets.load(withToken(avatarUrl))`; initials `Text`
  on a colored chip when an agent has no avatar (same fallback rule as today).
- **Environment:** target a **CC0 furniture pack** — candidate **Kenney** (e.g. a
  top-down furniture / roguelike set), pinned and confirmed during the implementation
  plan. **Programmatic `Graphics`** tiles are the guaranteed fallback for any missing
  piece, so the feature is never blocked on asset availability and isn't locked to a pack.
  `tiles.ts` is the only module that knows which backend is in use.

## Non-functional

- **Reduced motion:** honor `prefers-reduced-motion` → no walking (teleport), no idle bob,
  no day/night easing; static status rings + bubbles still shown. Toggled live via
  `OfficeScene.setReducedMotion`.
- **WebGL fallback:** Pixi v8 auto-selects WebGPU/WebGL; if init fails, render a graceful
  in-container message (no silent blank, since the DOM office is removed).
- **Performance:** one `Application` + ticker; `AgentToken` sprites pooled/reused; avatar
  textures cached via `Assets`; only active walkers/bubbles animate; capped walkers and
  bubbles; structural rebuild only on `structureKey` change; resolution capped at DPR ≤ 2;
  resize throttled; full teardown on tab unmount.

## Testing & verification

- **Unit (vitest, newly added to web):** `worldLayout.ts` — desks assigned to all agents,
  rooms don't overlap, every room has a door reachable from the corridor, COO office and
  unassigned area present. `pathfind.ts` — path routes through doors, respects
  walls/desks, returns empty/none when unreachable, handles same-tile start=goal.
- **e2e (Playwright):** extend the suite to assert the Office sub-tab mounts a `<canvas>`
  and produces no console errors (canvas internals aren't introspectable → smoke-level).
- **Manual (run/verify skill):** open Network → Office; trigger a COO delegation and a
  subagent spawn; observe walking through doors, bubbles, status rings, and a whiteboard
  updating on a pipeline run; resize the window; toggle reduced motion.
- **Build:** `pnpm --filter @otterbot/web build` clean (note: Pixi adds to bundle size).

## File changes (summary)

- **Add:** `office/PixiOffice.tsx`, `office/OfficeScene.ts`, `office/worldLayout.ts`,
  `office/pathfind.ts`, `office/AgentToken.ts`, `office/tiles.ts`, `office/whiteboard.ts`;
  vitest config + `*.test.ts` for the two pure modules.
- **Edit:** `NetworkView.tsx` (Office sub-tab renders `<PixiOffice>` instead of
  `<AgentOffice>`); `packages/web/package.json` (`pixi.js` dep, `vitest` dev-dep, `test`
  script).
- **Remove:** `office-layout.ts` and `AgentOffice.tsx` (the DOM office), plus their usage.

## Open items (to settle in the plan)

- Pin the exact CC0 furniture pack (or commit to programmatic-only for v1) and confirm
  with the user.
- Final tile size / camera-fit and minimum room sizing for tiny teams.
