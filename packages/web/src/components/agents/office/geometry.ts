/** Logical pixels per tile in world space (before camera scaling). */
export const TILE = 24;

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
