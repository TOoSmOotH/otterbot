import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { Cell, TILE } from "./geometry";
import type { World } from "./worldLayout";

const C = {
  floor: 0x3b2c25,
  floorLine: 0x251d19,
  floorGrain: 0x5b4437,
  rug: 0x26323d,
  rugLine: 0x1f2933,
  rugEdge: 0xb37a45,
  wall: 0x293848,
  wallDark: 0x10151b,
  wallPanel: 0x34485c,
  trim: 0xb37a45,
  door: 0x815334,
  deskTop: 0x714b31,
  deskEdge: 0x3b271b,
  plant: 0x3f8f5a,
  printer: 0xb9bec8,
};

const ATLAS_IMAGE = "/office/generated/office-assets-transparent.png";
const ATLAS_JSON = "/office/generated/office-assets.json";

// First-party Otterbot office sprites. Leave a key unset to keep the Graphics
// fallback for that item.
const ART: Partial<
  Record<
    | "door"
    | "plant"
    | "printer"
    | "deskPod"
    | "occupiedDeskPod"
    | "shelf"
    | "framedArt"
    | "largePlant"
    | "wallLamp"
    | "cabinet"
    | "whiteboard"
    | "floorTile"
    | "wallTile"
    | "glassWall"
    | "glassCorner"
    | "rug",
    string
  >
> = {
  door: "wooden_door",
  plant: "small_plant",
  printer: "printer",
  deskPod: "desk_empty",
  occupiedDeskPod: "workstation_occupied",
  shelf: "wall_shelf",
  framedArt: "framed_landscape",
  largePlant: "large_plant",
  wallLamp: "wall_lamp",
  cabinet: "cabinet",
  whiteboard: "whiteboard",
  floorTile: "wood_floor_tile",
  wallTile: "navy_wall_tile",
  glassWall: "glass_wall",
  glassCorner: "glass_corner",
  rug: "rug",
};

let sheet: Texture | null = null;
let frames: Record<string, Rectangle> | null = null;

/** Load the first-party office sheet + parse its generated JSON atlas. Safe to call repeatedly; no-throw. */
export async function loadOfficeAtlas(): Promise<void> {
  if (Object.keys(ART).length === 0) { frames = frames ?? {}; return; }
  if (frames) return;
  try {
    sheet = (await Assets.load(ATLAS_IMAGE)) as Texture;
    const atlas = (await (await fetch(ATLAS_JSON)).json()) as {
      frames?: Record<string, { x: number; y: number; w: number; h: number }>;
    };
    const out: Record<string, Rectangle> = {};
    for (const [name, frame] of Object.entries(atlas.frames ?? {})) {
      out[name] = new Rectangle(frame.x, frame.y, frame.w, frame.h);
    }
    frames = out;
  } catch {
    frames = {}; // atlas unavailable -> Graphics fallback everywhere
  }
}

/** A Sprite for an art key if mapped and loaded; else null (use Graphics). */
export function artSprite(key: keyof typeof ART): Sprite | null {
  const name = ART[key];
  if (!name || !sheet || !frames || !frames[name]) return null;
  const tex = new Texture({ source: sheet.source, frame: frames[name] });
  const s = new Sprite(tex);
  return s;
}

function placeSprite(
  root: Container,
  key: keyof typeof ART,
  x: number,
  y: number,
  w?: number,
  h?: number,
  fit: "contain" | "stretch" = "contain"
): boolean {
  const sprite = artSprite(key);
  if (!sprite) return false;
  if (w && h) {
    if (fit === "stretch") {
      sprite.x = Math.round(x);
      sprite.y = Math.round(y);
      sprite.width = Math.round(w);
      sprite.height = Math.round(h);
      root.addChild(sprite);
      return true;
    }
    const scale = Math.min(w / sprite.texture.width, h / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.x = Math.round(x + (w - sprite.texture.width * scale) / 2);
    sprite.y = Math.round(y + (h - sprite.texture.height * scale) / 2);
    root.addChild(sprite);
    return true;
  }
  sprite.x = Math.round(x);
  sprite.y = Math.round(y);
  root.addChild(sprite);
  return true;
}

function fillWithSprite(root: Container, key: keyof typeof ART, w: number, h: number, targetW: number, targetH: number): boolean {
  const probe = artSprite(key);
  if (!probe) return false;
  probe.destroy();
  for (let y = 0; y < h; y += targetH) {
    for (let x = 0; x < w; x += targetW) {
      placeSprite(root, key, x, y, Math.min(targetW, w - x), Math.min(targetH, h - y), "stretch");
    }
  }
  return true;
}

/** Draw the floor + walls + doors + desks for a world into a fresh Container. */
export function drawEnvironment(world: World): Container {
  const root = new Container();
  const floorLayer = new Container();
  const g = new Graphics();
  root.addChild(floorLayer, g);

  drawStudioFloor(floorLayer, g, world);
  drawRoomRugs(root, g, world);
  drawRoomShells(g, world);

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      const x = tx * TILE;
      const y = ty * TILE;
      switch (cell) {
        case Cell.WALL: {
          drawWall(root, g, tx, ty, world);
          break;
        }
        case Cell.DOOR: {
          if (!placeSprite(root, "door", x - 13, y - 39, 50, 68)) {
            g.rect(x + 3, y, TILE - 6, TILE).fill(C.door);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  drawRoomDecor(root, g, world);
  drawHallDecor(root, g, world);

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      if (cell === Cell.DESK) drawDeskPod(root, g, tx, ty, true);
    }
  }
  return root;
}

function drawStudioFloor(root: Container, g: Graphics, world: World): void {
  if (fillWithSprite(root, "floorTile", world.pxWidth, world.pxHeight, 96, 70)) return;

  g.rect(0, 0, world.pxWidth, world.pxHeight).fill(C.floor);

  for (let y = 0; y < world.pxHeight; y += 12) {
    g.rect(0, y, world.pxWidth, 1).fill(C.floorLine);
  }
  for (let row = 0; row < Math.ceil(world.pxHeight / 12); row++) {
    const y0 = row * 12;
    const offset = row % 2 ? 42 : 0;
    for (let x = offset; x < world.pxWidth; x += 84) {
      g.rect(x, y0 + 3, 27, 1).fill(C.floorGrain);
    }
  }
}

function drawRoomRugs(root: Container, g: Graphics, world: World): void {
  for (const room of world.rooms) {
    const pad = room.kind === "unassigned" ? 1 : 2;
    const x = room.x * TILE + pad * TILE;
    const y = room.y * TILE + pad * TILE;
    const w = Math.max(TILE, (room.w - pad * 2) * TILE);
    const h = Math.max(TILE, (room.h - pad * 2) * TILE);
    if (w <= 0 || h <= 0) continue;

    if (placeSprite(root, "rug", x + 4, y + 4, w - 8, h - 8, "stretch")) continue;

    const color = room.kind === "coo" ? 0x332b2a : C.rug;
    g.roundRect(x + 4, y + 4, w - 8, h - 8, 5).fill(color).stroke({ width: 2, color: C.rugEdge });
    for (let rx = x + 16; rx < x + w - 8; rx += 28) g.rect(rx, y + 8, 1, h - 16).fill(C.rugLine);
    for (let ry = y + 20; ry < y + h - 8; ry += 28) g.rect(x + 8, ry, w - 16, 1).fill(0x303d49);
  }
}

function drawRoomShells(g: Graphics, world: World): void {
  for (const room of world.rooms) {
    const x = room.x * TILE;
    const y = room.y * TILE;
    const w = room.w * TILE;
    const h = room.h * TILE;

    g.rect(x - 2, y - 5, w + 4, 6).fill(0x9a6a43);
    g.rect(x - 2, y - 1, w + 4, 2).fill(0x241714);
    g.rect(x - 4, y - 5, 5, h + 10).fill(0x1b1514);
    g.rect(x + w - 1, y - 5, 5, h + 10).fill(0x1b1514);
    g.rect(x - 2, y + h - 1, w + 4, 4).fill(0x1b1514);

    for (let px = x; px <= x + w; px += TILE * 4) {
      g.rect(px - 1, y - 8, 3, h + 14).fill(0xb48355);
      g.rect(px, y - 8, 1, h + 14).fill(0xe1b079);
    }
  }
}

function drawWall(root: Container, g: Graphics, tx: number, ty: number, world: World): void {
  const x = tx * TILE;
  const y = ty * TILE;
  const at = (nx: number, ny: number) =>
    nx >= 0 && ny >= 0 && nx < world.cols && ny < world.rows
      ? (world.grid[ny * world.cols + nx] as Cell)
      : Cell.WALL;
  const horiz = at(tx - 1, ty) === Cell.WALL || at(tx + 1, ty) === Cell.WALL;
  const frontGlass = horiz && at(tx, ty - 1) !== Cell.WALL && at(tx, ty + 1) !== Cell.WALL;

  if (frontGlass && placeSprite(root, "glassWall", x, y - 2, TILE, TILE + 4, "stretch")) return;
  if (!frontGlass && placeSprite(root, "wallTile", x, y, TILE, TILE, "stretch")) return;

  g.rect(x, y, TILE, TILE).fill(C.wallDark);
  if (frontGlass) {
    g.rect(x + 1, y + 2, TILE - 2, 3).fill(C.trim);
    g.rect(x + 2, y + 5, TILE - 4, TILE - 9).fill(0x5f7886);
    g.rect(x + 4, y + 7, TILE - 8, TILE - 13).fill(0x26333d);
    g.rect(x + 1, y + TILE - 4, TILE - 2, 3).fill(0x1b2027);
  } else if (horiz) {
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(C.wall);
    g.rect(x + 2, y + 3, TILE - 4, 6).fill(C.wallPanel);
    g.rect(x + 2, y + 9, TILE - 4, 2).fill(C.trim);
    g.rect(x + 5, y + 15, TILE - 10, 4).fill(0x1d2833);
  } else {
    g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(C.wall);
    g.rect(x + 3, y + 2, 6, TILE - 4).fill(C.wallPanel);
    g.rect(x + 9, y + 2, 2, TILE - 4).fill(C.trim);
    g.rect(x + 15, y + 5, 4, TILE - 10).fill(0x1d2833);
  }
}

function drawDeskPod(root: Container, g: Graphics, tx: number, ty: number, occupied: boolean): void {
  const x = tx * TILE - 40;
  const y = ty * TILE - 18;
  const w = 104;
  const h = 88;

  if (occupied && placeSprite(root, "occupiedDeskPod", x, y, w, h)) return;
  if (placeSprite(root, "deskPod", x, y + 8, w, h - 16)) return;

  g.roundRect(x + 4, y + 7, w, h, 5).fill(0x17120f);
  g.roundRect(x, y, w, h - 6, 5).fill(C.deskTop).stroke({ width: 2, color: 0xb37a45 });
  g.rect(x, y, w, 6).fill(0x9b6b43);
  g.rect(x, y + h - 10, w, 6).fill(C.deskEdge);
  g.rect(x + 4, y + h - 4, 10, 7).fill(0x211713);
  g.rect(x + w - 14, y + h - 4, 10, 7).fill(0x211713);

  g.rect(x + 6, y + 12, 15, 15).fill(0x5b3824).stroke({ width: 1, color: 0x2b1b13 });
  g.rect(x + 9, y + 16, 9, 1).fill(0xb37a45);
  g.rect(x + 9, y + 22, 9, 1).fill(0xb37a45);

  g.rect(x + 50, y + 10, 5, 10).fill(0x67412a);
  g.circle(x + 51, y + 8, 5).fill(0x4ba464);
  g.circle(x + 56, y + 11, 5).fill(0x78c981);
  g.circle(x + 47, y + 14, 5).fill(0x34784a);

  g.circle(x + 62, y + 14, 5).fill(0xe9ead2).stroke({ width: 1, color: 0x7a4f32 });
  g.rect(x + 65, y + 14, 3, 2).fill(0xe9ead2);
  g.rect(x + 23, y + 28, 27, 3).fill(0xd7dbe4);
  g.rect(x + 55, y + 27, 6, 8).fill(0xe2b13c);
  g.circle(x + 58, y + 25, 6).fill(0xffd98a);
}

function drawRoomDecor(root: Container, g: Graphics, world: World): void {
  for (const room of world.rooms) {
    const x = room.x * TILE;
    const y = room.y * TILE;
    const w = room.w * TILE;
    const h = room.h * TILE;
    if (room.kind !== "unassigned") {
      drawShelf(root, g, x + w - 70, y + 30);
      drawWallLamp(root, g, x + 18, y + 42);
    }
    if (room.kind === "coo") {
      drawFramedArt(root, g, x + 34, y + 52);
      drawLargePlant(root, g, x + 18, y + h - 58);
    } else if (room.kind === "project") {
      drawLargePlant(root, g, x + w - 48, y + 28);
      drawCabinet(root, g, x + w - 48, y + h - 64);
    } else {
      drawShelf(root, g, x + w - 76, y + 18);
      drawWallLamp(root, g, x + w - 36, y + 42);
      drawLargePlant(root, g, x + w - 58, y + h - 64);
    }
  }
}

function drawHallDecor(root: Container, g: Graphics, world: World): void {
  const hallY = Math.max(2, world.rows - 5) * TILE;
  drawLargePlant(root, g, TILE * 2, hallY + 20);
  drawCabinet(root, g, Math.round(world.pxWidth * 0.55), hallY + 34);
  drawWallLamp(root, g, Math.round(world.pxWidth * 0.52), hallY + 30);
  drawFramedArt(root, g, Math.round(world.pxWidth * 0.3), hallY + 28);
  if (world.pxWidth > 900) {
    drawLargePlant(root, g, world.pxWidth - TILE * 5, hallY + 12);
    drawCabinet(root, g, world.pxWidth - TILE * 12, hallY + 42);
  }
}

function drawShelf(root: Container, g: Graphics, x: number, y: number): void {
  if (placeSprite(root, "shelf", x, y - 28, 58, 36)) return;
  g.rect(x, y, 54, 6).fill(0x201713).stroke({ width: 1, color: 0xb37a45 });
  g.rect(x + 6, y - 14, 8, 14).fill(0x4ba464);
  g.rect(x + 17, y - 18, 6, 18).fill(0xd7a447);
  g.rect(x + 26, y - 15, 6, 15).fill(0xd9e2e4);
  g.rect(x + 39, y - 20, 9, 20).fill(0x7a4f32);
}

function drawFramedArt(root: Container, g: Graphics, x: number, y: number): void {
  if (placeSprite(root, "framedArt", x, y, 70, 44)) return;
  g.rect(x, y, 66, 36).fill(0x201713).stroke({ width: 2, color: 0xb37a45 });
  g.rect(x + 5, y + 5, 56, 26).fill(0x7fb0d6);
  g.rect(x + 5, y + 20, 56, 11).fill(0x456f48);
  g.rect(x + 12, y + 16, 18, 6).fill(0xd2a94d);
}

function drawLargePlant(root: Container, g: Graphics, x: number, y: number): void {
  if (placeSprite(root, "largePlant", x, y, 52, 62)) return;
  g.rect(x + 12, y + 34, 18, 15).fill(0x8a5638).stroke({ width: 1, color: 0x3b271b });
  g.circle(x + 8, y + 22, 9).fill(0x3f8f5a);
  g.circle(x + 22, y + 12, 12).fill(0x4ba464);
  g.circle(x + 34, y + 24, 11).fill(0x78c981);
  g.circle(x + 20, y + 29, 10).fill(0x34784a);
}

function drawWallLamp(root: Container, g: Graphics, x: number, y: number): void {
  if (placeSprite(root, "wallLamp", x, y, 24, 48)) return;
  g.rect(x + 5, y, 6, 12).fill(0x5b3824);
  g.circle(x + 8, y + 15, 9).fill(0xffd98a);
  g.circle(x + 8, y + 15, 5).fill(0xe2b13c);
}

function drawCabinet(root: Container, g: Graphics, x: number, y: number): void {
  if (placeSprite(root, "cabinet", x, y, 52, 44)) return;
  g.rect(x, y, 34, 45).fill(0x5b3824).stroke({ width: 1, color: 0x2b1b13 });
  g.rect(x + 5, y + 8, 24, 10).fill(0x714b31);
  g.rect(x + 5, y + 25, 24, 10).fill(0x714b31);
  g.rect(x + 16, y + 12, 3, 2).fill(0xb37a45);
  g.rect(x + 16, y + 29, 3, 2).fill(0xb37a45);
}

/** A simple potted-plant prop at a tile. */
export function drawPlant(tx: number, ty: number): Container {
  const root = new Container();
  if (placeSprite(root, "plant", tx * TILE - 4, ty * TILE - 18, 28, 40)) return root;
  const g = new Graphics();
  g.rect(tx * TILE + 5, ty * TILE + 9, 6, 5).fill(0x8a5a3c);
  g.circle(tx * TILE + 8, ty * TILE + 6, 5).fill(C.plant);
  return g;
}

/** A simple printer prop at a tile. */
export function drawPrinter(tx: number, ty: number): Container {
  const root = new Container();
  if (placeSprite(root, "printer", tx * TILE - 14, ty * TILE - 18, 52, 52)) return root;
  const g = new Graphics();
  g.rect(tx * TILE + 3, ty * TILE + 5, 10, 8).fill(C.printer);
  g.rect(tx * TILE + 5, ty * TILE + 3, 6, 3).fill(0x8b93a3);
  return g;
}
