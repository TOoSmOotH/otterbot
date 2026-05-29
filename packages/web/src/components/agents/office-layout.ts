import type { AgentProfileSummary } from "@otterbot/shared";
import type { Project } from "../../stores/projects-store";

/**
 * Desk footprint and floor spacing, in the office's virtual coordinate space.
 * Desk centers are derived arithmetically from these so the envelope animation
 * never needs to measure the DOM.
 */
export const DESK_W = 132;
export const DESK_H = 104;
export const GAP_X = 40;
export const GAP_Y = 44;
const PAD = 32;
const GROUP_PAD = 22;
const GROUP_TITLE = 28;
const GROUP_GAP = 44;

export interface DeskPlacement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  isCoo: boolean;
  /** Center point, for routing message envelopes. */
  cx: number;
  cy: number;
}

/** A labeled boundary drawn behind a project's desks. */
export interface GroupBox {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeskFloor {
  desks: DeskPlacement[];
  groups: GroupBox[];
  width: number;
  height: number;
}

/**
 * Lay the agents out by project: each project's members cluster as a "room"
 * inside a labeled boundary, agents with no project tile in a trailing boxless
 * cluster, and the COO is pinned to the top, centered over everything (it
 * reaches all agents implicitly). Clusters flow left-to-right and wrap at
 * `maxWidth`. Each agent is claimed by the first project that lists it as a
 * member — mirroring the roster and the permissions graph.
 *
 * Ordering within a cluster follows the project's team-role order, then name;
 * cluster order follows project order. Nothing is keyed on mutable status, so
 * desks keep a stable position as agents change state.
 */
export function deskLayout(
  agents: AgentProfileSummary[],
  projects: Project[],
  maxWidth: number
): DeskFloor {
  const coo = agents.find((a) => a.role === "coo") ?? null;

  const idSet = new Set(agents.map((a) => a.id));
  const projectOf = new Map<string, Project>();
  for (const p of projects) {
    for (const m of p.members) {
      if (idSet.has(m.agentId) && !projectOf.has(m.agentId)) projectOf.set(m.agentId, p);
    }
  }

  // Partition non-COO agents into per-project buckets + a standalone bucket.
  const byProject = new Map<string, AgentProfileSummary[]>();
  const standalone: AgentProfileSummary[] = [];
  for (const a of agents) {
    if (a.id === coo?.id) continue;
    const p = projectOf.get(a.id);
    if (p) {
      const list = byProject.get(p.id) ?? [];
      list.push(a);
      byProject.set(p.id, list);
    } else {
      standalone.push(a);
    }
  }

  const clusters: { key: string; label: string | null; members: AgentProfileSummary[] }[] = [];
  for (const p of projects) {
    const members = byProject.get(p.id);
    if (!members || members.length === 0) continue;
    const order = new Map(p.team.map((t, i) => [t.agentId, i] as const));
    members.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        a.displayName.localeCompare(b.displayName)
    );
    clusters.push({ key: p.id, label: p.name, members });
  }
  if (standalone.length) {
    standalone.sort((a, b) => a.displayName.localeCompare(b.displayName));
    // Labeled "Unassigned" only when there are also project rooms to contrast it
    // against; with no projects at all everyone just tiles boxlessly.
    clusters.push({
      key: "__standalone",
      label: clusters.length > 0 ? "Unassigned" : null,
      members: standalone,
    });
  }

  const cellW = DESK_W + GAP_X;
  const cellH = DESK_H + GAP_Y;
  const usableW = Math.max(maxWidth, DESK_W + GROUP_PAD * 2 + PAD * 2);
  const maxColsByWidth = Math.max(
    1,
    Math.floor((usableW - PAD * 2 - GROUP_PAD * 2 + GAP_X) / cellW)
  );

  const desks: DeskPlacement[] = [];
  const groups: GroupBox[] = [];
  let curX = PAD;
  let rowY = coo ? PAD + DESK_H + 64 : PAD; // leave room for the COO above
  let rowMaxH = 0;

  for (const c of clusters) {
    const cols = Math.min(Math.max(1, Math.ceil(Math.sqrt(c.members.length))), maxColsByWidth);
    const rows = Math.ceil(c.members.length / cols);
    const titleH = c.label ? GROUP_TITLE : 0;
    const innerW = cols * cellW - GAP_X;
    const innerH = rows * cellH - GAP_Y;
    const boxW = innerW + GROUP_PAD * 2;
    const boxH = innerH + GROUP_PAD * 2 + titleH;
    if (curX > PAD && curX + boxW > usableW - PAD) {
      curX = PAD;
      rowY += rowMaxH + GROUP_GAP;
      rowMaxH = 0;
    }
    const boxX = curX;
    const boxY = rowY;
    c.members.forEach((m, i) => {
      const cc = i % cols;
      const rr = Math.floor(i / cols);
      const x = boxX + GROUP_PAD + cc * cellW;
      const y = boxY + GROUP_PAD + titleH + rr * cellH;
      desks.push({ id: m.id, x, y, w: DESK_W, h: DESK_H, isCoo: false, cx: x + DESK_W / 2, cy: y + DESK_H / 2 });
    });
    if (c.label) groups.push({ id: `grp-${c.key}`, label: c.label, x: boxX, y: boxY, w: boxW, h: boxH });
    curX += boxW + GROUP_GAP;
    rowMaxH = Math.max(rowMaxH, boxH);
  }

  let maxRight = PAD;
  let maxBottom = PAD;
  for (const d of desks) {
    maxRight = Math.max(maxRight, d.x + d.w);
    maxBottom = Math.max(maxBottom, d.y + d.h);
  }
  for (const g of groups) {
    maxRight = Math.max(maxRight, g.x + g.w);
    maxBottom = Math.max(maxBottom, g.y + g.h);
  }

  // Center the COO on the top row over the widest extent.
  if (coo) {
    const centerX = (PAD + maxRight) / 2;
    const x = Math.max(PAD, centerX - DESK_W / 2);
    const y = PAD;
    desks.push({ id: coo.id, x, y, w: DESK_W, h: DESK_H, isCoo: true, cx: x + DESK_W / 2, cy: y + DESK_H / 2 });
    maxRight = Math.max(maxRight, x + DESK_W);
  }

  return { desks, groups, width: maxRight + PAD, height: maxBottom + PAD };
}
