import { Cell, TILE } from "./geometry";
import { roomObjects, type ObjectFit, type OfficeAtlas, type RoomObject } from "./roomPrefabs";
import type { DeskSlot, World } from "./worldLayout";

export type TileKey = "floor" | "wall" | "door" | "desk";
export type ObjectKind = "sprite" | "desk" | "worker" | "nameplate" | "whiteboard";

export interface TileLayer {
  cols: number;
  rows: number;
  tiles: TileKey[];
}

export interface OfficeObject {
  kind: ObjectKind;
  atlas?: OfficeAtlas;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fit?: ObjectFit;
  roomId?: string;
  agentId?: string;
  label?: string;
  tx?: number;
  ty?: number;
  wTiles?: number;
}

export interface OfficeMap {
  width: number;
  height: number;
  tileLayer: TileLayer;
  objects: OfficeObject[];
}

export function buildOfficeMap(world: World): OfficeMap {
  const objects: OfficeObject[] = [];

  for (const room of world.rooms) {
    objects.push(...roomObjects(room, TILE).map(mapRoomObject));
    if (room.label) {
      objects.push({
        kind: "nameplate",
        x: room.x * TILE,
        y: room.y * TILE,
        w: room.w * TILE,
        h: 18,
        label: room.label,
        roomId: room.id,
      });
    }
    if (room.whiteboard) {
      objects.push({
        kind: "whiteboard",
        x: room.whiteboard.tx * TILE,
        y: room.whiteboard.ty * TILE,
        w: room.whiteboard.wTiles * TILE,
        h: TILE * 2,
        roomId: room.id,
        tx: room.whiteboard.tx,
        ty: room.whiteboard.ty,
        wTiles: room.whiteboard.wTiles,
      });
    }
    for (const slot of room.desks) {
      objects.push(deskObject(slot), workerObject(slot));
    }
  }

  objects.push(...hallObjects(world));

  return {
    width: world.pxWidth,
    height: world.pxHeight,
    tileLayer: {
      cols: world.cols,
      rows: world.rows,
      tiles: Array.from(world.grid, (cell) => mapCell(cell as Cell)),
    },
    objects,
  };
}

function mapCell(cell: Cell): TileKey {
  if (cell === Cell.WALL) return "wall";
  if (cell === Cell.DOOR) return "door";
  if (cell === Cell.DESK) return "desk";
  return "floor";
}

function mapRoomObject(object: RoomObject): OfficeObject {
  return {
    kind: "sprite",
    atlas: object.atlas,
    name: object.name,
    x: object.x,
    y: object.y,
    w: object.w,
    h: object.h,
    fit: object.fit,
  };
}

function deskObject(slot: DeskSlot): OfficeObject {
  return {
    kind: "desk",
    x: slot.deskTx * TILE - 40,
    y: slot.deskTy * TILE - 18,
    w: 104,
    h: 88,
    agentId: slot.agentId,
  };
}

function workerObject(slot: DeskSlot): OfficeObject {
  return {
    kind: "worker",
    x: slot.deskTx * TILE - 8,
    y: slot.deskTy * TILE + 4,
    w: 40,
    h: 66,
    agentId: slot.agentId,
  };
}

function hallObjects(world: World): OfficeObject[] {
  const hallY = Math.max(2, world.rows - 5) * TILE;
  return [
    sprite("props", "exit_double_door", TILE * 2, hallY + 4, 92, 104),
    sprite("props", "planter_box", TILE * 7, hallY + 30, 150, 58),
    sprite("props", "console_table_lamp_photo", Math.round(world.pxWidth * 0.5), hallY + 22, 132, 66),
    sprite("props", "green_runner_rug", Math.round(world.pxWidth * 0.68), hallY + 44, 160, 50, "stretch"),
    sprite("props", "printer_station", world.pxWidth - TILE * 7, hallY + 14, 66, 74),
    sprite("office", "large_plant", TILE * 2, hallY + 20, 52, 62),
    sprite("office", "cabinet", Math.round(world.pxWidth * 0.55), hallY + 34, 52, 44),
    sprite("office", "wall_lamp", Math.round(world.pxWidth * 0.52), hallY + 30, 24, 48),
    sprite("office", "framed_landscape", Math.round(world.pxWidth * 0.3), hallY + 28, 70, 44),
    ...(world.pxWidth > 900
      ? [
          sprite("office", "large_plant", world.pxWidth - TILE * 5, hallY + 12, 52, 62),
          sprite("office", "cabinet", world.pxWidth - TILE * 12, hallY + 42, 52, 44),
        ]
      : []),
  ];
}

function sprite(
  atlas: OfficeAtlas,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fit?: ObjectFit
): OfficeObject {
  return { kind: "sprite", atlas, name, x, y, w, h, fit };
}
