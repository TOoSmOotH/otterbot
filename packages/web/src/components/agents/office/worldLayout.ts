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
  x: number;
  y: number;
  w: number;
  h: number;
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

const CELL_W = 4;
const CELL_H = 4;
const MAX_DESK_COLS = 3;
const ROOM_GAP = 2;
const ROW_GAP = 3;
const ROOM_MIN: Record<Room["kind"], { w: number; h: number; topRows: number }> = {
  coo: { w: 14, h: 17, topRows: 6 },
  project: { w: 25, h: 17, topRows: 5 },
  unassigned: { w: 22, h: 17, topRows: 3 },
};

interface Cluster {
  id: string;
  label: string | null;
  kind: Room["kind"];
  members: AgentProfileSummary[];
}

function clusterDims(n: number, kind: Room["kind"]) {
  const deskCols = Math.min(Math.max(1, Math.ceil(Math.sqrt(n))), MAX_DESK_COLS);
  const deskRows = Math.ceil(n / deskCols);
  const topRows = ROOM_MIN[kind].topRows;
  const border = 1;
  const interiorW = deskCols * CELL_W;
  const interiorH = topRows + deskRows * CELL_H;
  return {
    deskCols,
    deskRows,
    border,
    topRows,
    w: Math.max(ROOM_MIN[kind].w, interiorW + border * 2),
    h: Math.max(ROOM_MIN[kind].h, interiorH + border * 2),
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
    clusters.push({ id: "unassigned", label: "Agents", kind: "unassigned", members: standalone });
  }

  type Placed = Cluster & { dims: ReturnType<typeof clusterDims>; x: number; y: number };
  const placed: Placed[] = [];
  const cooCluster = clusters.find((c) => c.kind === "coo");
  const projectClusters = clusters.filter((c) => c.kind === "project");
  const agentCluster = clusters.find((c) => c.kind === "unassigned");
  const cooDims = cooCluster ? clusterDims(cooCluster.members.length, cooCluster.kind) : null;
  const agentDims = agentCluster ? clusterDims(agentCluster.members.length, agentCluster.kind) : null;
  const projectDims = projectClusters.map((c) => clusterDims(c.members.length, c.kind));
  const maxProjectW = projectDims.reduce((max, dims) => Math.max(max, dims.w), 0);
  const place = (c: Cluster, dims: ReturnType<typeof clusterDims>, x: number, y: number) => {
    placed.push({ ...c, dims, x, y });
  };

  const leftColumnW = Math.max(cooDims?.w ?? 0, agentDims?.w ?? 0);
  if (cooCluster && cooDims) place(cooCluster, cooDims, 1, 1);
  if (agentCluster && agentDims) {
    const agentY = cooDims ? 1 + cooDims.h + ROW_GAP : 1;
    place(agentCluster, agentDims, 1, agentY);
  }

  const projectX = leftColumnW > 0 ? 1 + leftColumnW + ROOM_GAP : 1;
  let projectY = 1;
  projectClusters.forEach((c, i) => {
    const dims = { ...projectDims[i], w: Math.max(projectDims[i].w, maxProjectW) };
    place(c, dims, projectX, projectY);
    projectY += dims.h + ROW_GAP;
  });

  const contentRight = placed.reduce((m, p) => Math.max(m, p.x + p.dims.w), 1);
  const contentBottom = placed.reduce((m, p) => Math.max(m, p.y + p.dims.h), 1);
  const cols = contentRight + 1;
  // Extra lower corridor/lounge space keeps the office from reading like a
  // skinny strip when the view is scaled to a wide dashboard panel.
  const rows = contentBottom + 6;
  const grid = new Uint8Array(cols * rows).fill(Cell.FLOOR);
  const set = (tx: number, ty: number, v: Cell) => {
    if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) grid[ty * cols + tx] = v;
  };

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

    for (let tx = x; tx < x + dims.w; tx++) {
      set(tx, y, Cell.WALL);
      set(tx, y + dims.h - 1, Cell.WALL);
    }
    for (let ty = y; ty < y + dims.h; ty++) {
      set(x, ty, Cell.WALL);
      set(x + dims.w - 1, ty, Cell.WALL);
    }
    room.doorTx = x + Math.floor(dims.w / 2);
    room.doorTy = y + dims.h - 1;
    set(room.doorTx, room.doorTy, Cell.DOOR);
    if (p.kind === "project") {
      room.whiteboard = { tx: x + 1, ty: y + 1, wTiles: Math.max(2, dims.w - 2) };
    }

    const deskAreaW = dims.deskCols * CELL_W;
    const innerW = dims.w - dims.border * 2;
    const innerX = x + dims.border + Math.floor(Math.max(0, innerW - deskAreaW) / 2);
    const innerY = y + dims.border + dims.topRows;
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
      room.desks.push(slot);
      deskOf[m.id] = slot;
    });

    rooms.push(room);
  }

  return { cols, rows, grid, rooms, deskOf, pxWidth: cols * TILE, pxHeight: rows * TILE };
}
