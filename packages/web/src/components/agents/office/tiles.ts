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

const ATLAS_IMAGE = "/office/otter-office-v3.png";
const ATLAS_XML = "/office/otter-office-v3.xml";

// First-party Otterbot office sprites. Leave a key unset to keep the Graphics
// fallback for that item.
const ART: Partial<
  Record<"floor" | "floorAlt" | "wall" | "door" | "desk" | "plant" | "printer", string>
> = {
  floor: "floor.png",
  floorAlt: "floor_alt.png",
  wall: "wall.png",
  door: "door.png",
  desk: "desk.png",
  plant: "plant.png",
  printer: "printer.png",
};

let sheet: Texture | null = null;
let frames: Record<string, Rectangle> | null = null;

/** Load the first-party office sheet + parse its XML atlas. Safe to call repeatedly; no-throw. */
export async function loadOfficeAtlas(): Promise<void> {
  if (Object.keys(ART).length === 0) { frames = frames ?? {}; return; }
  if (frames) return;
  try {
    sheet = (await Assets.load(ATLAS_IMAGE)) as Texture;
    const xml = await (await fetch(ATLAS_XML)).text();
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
    frames = {}; // atlas unavailable -> Graphics fallback everywhere
  }
}

/** A Sprite for an art key if mapped and loaded; else null (use Graphics). */
export function artSprite(key: keyof typeof ART): Sprite | null {
  const name = ART[key];
  if (!name || !sheet || !frames || !frames[name]) return null;
  const tex = new Texture({ source: sheet.source, frame: frames[name] });
  const s = new Sprite(tex);
  s.width = TILE;
  s.height = TILE;
  return s;
}

/** Draw the floor + walls + doors + desks for a world into a fresh Container. */
export function drawEnvironment(world: World): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);

  drawStudioFloor(g, world);
  drawRoomRugs(g, world);

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      const x = tx * TILE;
      const y = ty * TILE;
      switch (cell) {
        case Cell.WALL: {
          drawWall(g, tx, ty, world);
          break;
        }
        case Cell.DOOR: {
          const doorSprite = artSprite("door");
          if (doorSprite) {
            doorSprite.x = x;
            doorSprite.y = y;
            root.addChild(doorSprite);
          } else {
            g.rect(x + 3, y, TILE - 6, TILE).fill(C.door);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  drawRoomDecor(g, world);

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      if (cell === Cell.DESK) drawDeskPod(g, tx, ty);
    }
  }
  return root;
}

function drawStudioFloor(g: Graphics, world: World): void {
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

function drawRoomRugs(g: Graphics, world: World): void {
  for (const room of world.rooms) {
    const pad = room.kind === "unassigned" ? 1 : 2;
    const x = room.x * TILE + pad * TILE;
    const y = room.y * TILE + pad * TILE;
    const w = Math.max(TILE, (room.w - pad * 2) * TILE);
    const h = Math.max(TILE, (room.h - pad * 2) * TILE);
    if (w <= 0 || h <= 0) continue;

    const color = room.kind === "coo" ? 0x332b2a : C.rug;
    g.roundRect(x + 4, y + 4, w - 8, h - 8, 5).fill(color).stroke({ width: 2, color: C.rugEdge });
    for (let rx = x + 16; rx < x + w - 8; rx += 28) g.rect(rx, y + 8, 1, h - 16).fill(C.rugLine);
    for (let ry = y + 20; ry < y + h - 8; ry += 28) g.rect(x + 8, ry, w - 16, 1).fill(0x303d49);
  }
}

function drawWall(g: Graphics, tx: number, ty: number, world: World): void {
  const x = tx * TILE;
  const y = ty * TILE;
  const at = (nx: number, ny: number) =>
    nx >= 0 && ny >= 0 && nx < world.cols && ny < world.rows
      ? (world.grid[ny * world.cols + nx] as Cell)
      : Cell.WALL;
  const horiz = at(tx - 1, ty) === Cell.WALL || at(tx + 1, ty) === Cell.WALL;
  const frontGlass = horiz && at(tx, ty - 1) !== Cell.WALL && at(tx, ty + 1) !== Cell.WALL;

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

function drawDeskPod(g: Graphics, tx: number, ty: number): void {
  const x = tx * TILE - 24;
  const y = ty * TILE - 2;
  const w = 72;
  const h = 45;

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

function drawRoomDecor(g: Graphics, world: World): void {
  for (const room of world.rooms) {
    const x = room.x * TILE;
    const y = room.y * TILE;
    const w = room.w * TILE;
    const h = room.h * TILE;
    if (room.kind !== "unassigned") {
      drawShelf(g, x + w - 70, y + 30);
      drawWallLamp(g, x + 18, y + 42);
    }
    if (room.kind === "coo") {
      drawFramedArt(g, x + 34, y + 52);
      drawLargePlant(g, x + 18, y + h - 58);
    } else if (room.kind === "project") {
      drawLargePlant(g, x + w - 48, y + 28);
      drawCabinet(g, x + w - 48, y + h - 64);
    } else {
      drawShelf(g, x + w - 76, y + 18);
      drawWallLamp(g, x + w - 36, y + 42);
      drawLargePlant(g, x + w - 58, y + h - 64);
    }
  }
}

function drawShelf(g: Graphics, x: number, y: number): void {
  g.rect(x, y, 54, 6).fill(0x201713).stroke({ width: 1, color: 0xb37a45 });
  g.rect(x + 6, y - 14, 8, 14).fill(0x4ba464);
  g.rect(x + 17, y - 18, 6, 18).fill(0xd7a447);
  g.rect(x + 26, y - 15, 6, 15).fill(0xd9e2e4);
  g.rect(x + 39, y - 20, 9, 20).fill(0x7a4f32);
}

function drawFramedArt(g: Graphics, x: number, y: number): void {
  g.rect(x, y, 66, 36).fill(0x201713).stroke({ width: 2, color: 0xb37a45 });
  g.rect(x + 5, y + 5, 56, 26).fill(0x7fb0d6);
  g.rect(x + 5, y + 20, 56, 11).fill(0x456f48);
  g.rect(x + 12, y + 16, 18, 6).fill(0xd2a94d);
}

function drawLargePlant(g: Graphics, x: number, y: number): void {
  g.rect(x + 12, y + 34, 18, 15).fill(0x8a5638).stroke({ width: 1, color: 0x3b271b });
  g.circle(x + 8, y + 22, 9).fill(0x3f8f5a);
  g.circle(x + 22, y + 12, 12).fill(0x4ba464);
  g.circle(x + 34, y + 24, 11).fill(0x78c981);
  g.circle(x + 20, y + 29, 10).fill(0x34784a);
}

function drawWallLamp(g: Graphics, x: number, y: number): void {
  g.rect(x + 5, y, 6, 12).fill(0x5b3824);
  g.circle(x + 8, y + 15, 9).fill(0xffd98a);
  g.circle(x + 8, y + 15, 5).fill(0xe2b13c);
}

function drawCabinet(g: Graphics, x: number, y: number): void {
  g.rect(x, y, 34, 45).fill(0x5b3824).stroke({ width: 1, color: 0x2b1b13 });
  g.rect(x + 5, y + 8, 24, 10).fill(0x714b31);
  g.rect(x + 5, y + 25, 24, 10).fill(0x714b31);
  g.rect(x + 16, y + 12, 3, 2).fill(0xb37a45);
  g.rect(x + 16, y + 29, 3, 2).fill(0xb37a45);
}

/** A simple potted-plant prop at a tile. */
export function drawPlant(tx: number, ty: number): Container {
  const sprite = artSprite("plant");
  if (sprite) {
    sprite.x = tx * TILE;
    sprite.y = ty * TILE;
    return sprite;
  }
  const g = new Graphics();
  g.rect(tx * TILE + 5, ty * TILE + 9, 6, 5).fill(0x8a5a3c);
  g.circle(tx * TILE + 8, ty * TILE + 6, 5).fill(C.plant);
  return g;
}

/** A simple printer prop at a tile. */
export function drawPrinter(tx: number, ty: number): Container {
  const sprite = artSprite("printer");
  if (sprite) {
    sprite.x = tx * TILE;
    sprite.y = ty * TILE;
    return sprite;
  }
  const g = new Graphics();
  g.rect(tx * TILE + 3, ty * TILE + 5, 10, 8).fill(C.printer);
  g.rect(tx * TILE + 5, ty * TILE + 3, 6, 3).fill(0x8b93a3);
  return g;
}
