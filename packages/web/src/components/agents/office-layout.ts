import type { AgentProfileSummary } from "@otterbot/shared";

/**
 * Desk footprint and floor spacing, in the office's virtual coordinate space.
 * Desk centers are derived arithmetically from these so the envelope animation
 * never needs to measure the DOM.
 */
export const DESK_W = 132;
export const DESK_H = 104;
export const GAP_X = 40;
export const GAP_Y = 56;
const PAD = 32;

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

export interface DeskFloor {
  desks: DeskPlacement[];
  width: number;
  height: number;
}

/**
 * Lay out the agents (COO + top-level agents; subagents excluded) at desks in a
 * responsive grid. The COO gets the centered front-row desk; the rest tile below.
 *
 * Ordering is intentionally keyed by the immutable `id` (never displayName or
 * status, which mutate as agents are renamed or change state) so desks keep a
 * stable position as the roster streams in and statuses tick.
 */
export function deskLayout(agents: AgentProfileSummary[], cols: number): DeskFloor {
  const c = Math.max(1, cols);
  const coo = agents.find((a) => a.role === "coo") ?? null;
  const rest = agents
    .filter((a) => a.role === "agent")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ordered = coo ? [coo, ...rest] : rest;

  const cellW = DESK_W + GAP_X;
  const cellH = DESK_H + GAP_Y;
  const desks: DeskPlacement[] = [];

  ordered.forEach((agent, i) => {
    const isCoo = agent.id === coo?.id;
    let col: number;
    let row: number;
    if (isCoo) {
      // Front row, horizontally centered.
      row = 0;
      col = (c - 1) / 2;
    } else {
      // Tile the remaining agents starting on row 1 (below the COO).
      const idx = coo ? i - 1 : i;
      row = coo ? 1 + Math.floor(idx / c) : Math.floor(idx / c);
      col = idx % c;
    }
    const x = PAD + col * cellW;
    const y = PAD + row * cellH;
    desks.push({
      id: agent.id,
      x,
      y,
      w: DESK_W,
      h: DESK_H,
      isCoo,
      cx: x + DESK_W / 2,
      cy: y + DESK_H / 2,
    });
  });

  const maxRight = desks.reduce((m, d) => Math.max(m, d.x + d.w), 0);
  const maxBottom = desks.reduce((m, d) => Math.max(m, d.y + d.h), 0);
  return {
    desks,
    width: Math.max(maxRight + PAD, c * cellW + PAD),
    height: maxBottom + PAD,
  };
}
