import type { Room } from "./worldLayout";

export type RoomKind = Room["kind"];
export type OfficeAtlas = "office" | "characters" | "props";
export type ObjectFit = "contain" | "stretch";

export interface RoomMeasure {
  deskCols: number;
  deskRows: number;
  border: number;
  topRows: number;
  w: number;
  h: number;
}

export interface RoomObject {
  atlas: OfficeAtlas;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit?: ObjectFit;
  layer?: "wall" | "floor";
}

interface RoomPrefab {
  minW: number;
  minH: number;
  topRows: number;
  floor: "rug" | "wood";
  objects(room: Room, tile: number): RoomObject[];
}

export const DESK_CELL_W = 4;
export const DESK_CELL_H = 4;
const MAX_DESK_COLS = 3;

export const ROOM_GAP = 2;
export const ROW_GAP = 3;

const ROOM_PREFABS: Record<RoomKind, RoomPrefab> = {
  coo: {
    minW: 14,
    minH: 17,
    topRows: 6,
    floor: "rug",
    objects: (room, tile) => {
      const { x, y, w, h } = roomBounds(room, tile);
      return [
        officeObject("framed_landscape", x + 42, y + 36, 70, 44, undefined, "wall"),
        officeObject("wall_shelf", x + w - 86, y + 24, 58, 36, undefined, "wall"),
        officeObject("wall_lamp", x + 18, y + 70, 24, 48, undefined, "wall"),
        officeObject("large_plant", x + 22, y + h - 62, 52, 62, undefined, "floor"),
        propObject("side_table_lamp", x + w - 52, y + h - 88, 28, 56, undefined, "floor"),
      ];
    },
  },
  project: {
    minW: 25,
    minH: 17,
    topRows: 5,
    floor: "rug",
    objects: (room, tile) => {
      const { x, y, w } = roomBounds(room, tile);
      return [
        officeObject("wall_lamp", x + 12, y + 70, 24, 48, undefined, "wall"),
        officeObject("large_plant", x + w - 70, y + 38, 52, 62, undefined, "floor"),
      ];
    },
  },
  unassigned: {
    minW: 22,
    minH: 17,
    topRows: 3,
    floor: "wood",
    objects: (room, tile) => {
      const { x, y, w, h } = roomBounds(room, tile);
      return [
        officeObject("wall_shelf", x + w - 88, y + 24, 58, 36, undefined, "wall"),
        officeObject("wall_lamp", x + w - 42, y + 70, 24, 48, undefined, "wall"),
        officeObject("large_plant", x + w - 64, y + h - 68, 52, 62, undefined, "floor"),
        propObject("printer_station", x + w - 78, y + h - 88, 54, 64, undefined, "floor"),
      ];
    },
  },
};

export function measureRoom(memberCount: number, kind: RoomKind): RoomMeasure {
  const deskCols = Math.min(Math.max(1, Math.ceil(Math.sqrt(memberCount))), MAX_DESK_COLS);
  const deskRows = Math.ceil(memberCount / deskCols);
  const prefab = ROOM_PREFABS[kind];
  const border = 1;
  const interiorW = deskCols * DESK_CELL_W;
  const interiorH = prefab.topRows + deskRows * DESK_CELL_H;
  return {
    deskCols,
    deskRows,
    border,
    topRows: prefab.topRows,
    w: Math.max(prefab.minW, interiorW + border * 2),
    h: Math.max(prefab.minH, interiorH + border * 2),
  };
}

export function roomObjects(room: Room, tile: number): RoomObject[] {
  return ROOM_PREFABS[room.kind].objects(room, tile);
}

function roomBounds(room: Room, tile: number) {
  return {
    x: room.x * tile,
    y: room.y * tile,
    w: room.w * tile,
    h: room.h * tile,
  };
}

function officeObject(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fit?: ObjectFit,
  layer?: RoomObject["layer"]
): RoomObject {
  return { atlas: "office", name, x, y, w, h, fit, layer };
}

function propObject(
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fit?: ObjectFit,
  layer?: RoomObject["layer"]
): RoomObject {
  return { atlas: "props", name, x, y, w, h, fit, layer };
}
