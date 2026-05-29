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
        case Cell.DESK: {
          const deskSprite = artSprite("desk");
          if (deskSprite) {
            deskSprite.x = x;
            deskSprite.y = y;
            root.addChild(deskSprite);
          } else {
            g.rect(x + 1, y + 3, TILE - 2, TILE - 5).fill(C.deskTop);
            g.rect(x + 1, y + TILE - 4, TILE - 2, 3).fill(C.deskEdge);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return root;
}

function drawStudioFloor(g: Graphics, world: World): void {
  g.rect(0, 0, world.pxWidth, world.pxHeight).fill(C.floor);

  for (let y = 0; y < world.pxHeight; y += 8) {
    g.rect(0, y, world.pxWidth, 1).fill(C.floorLine);
  }
  for (let row = 0; row < Math.ceil(world.pxHeight / 8); row++) {
    const y0 = row * 8;
    const offset = row % 2 ? 28 : 0;
    for (let x = offset; x < world.pxWidth; x += 56) {
      g.rect(x, y0 + 2, 18, 1).fill(C.floorGrain);
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
    g.roundRect(x + 2, y + 2, w - 4, h - 4, 3).fill(color).stroke({ width: 1, color: C.rugEdge });
    for (let rx = x + 10; rx < x + w - 4; rx += 18) g.rect(rx, y + 4, 1, h - 8).fill(C.rugLine);
    for (let ry = y + 12; ry < y + h - 4; ry += 18) g.rect(x + 4, ry, w - 8, 1).fill(0x303d49);
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

  g.rect(x, y, TILE, TILE).fill(C.wallDark);
  g.rect(x + 1, y + 1, TILE - 2, TILE - 2).fill(C.wall);
  if (horiz) {
    g.rect(x + 1, y + 2, TILE - 2, 4).fill(C.wallPanel);
    g.rect(x + 1, y + 6, TILE - 2, 1).fill(C.trim);
    g.rect(x + 3, y + 9, TILE - 6, 3).fill(0x1d2833);
  } else {
    g.rect(x + 2, y + 1, 4, TILE - 2).fill(C.wallPanel);
    g.rect(x + 6, y + 1, 1, TILE - 2).fill(C.trim);
    g.rect(x + 9, y + 3, 3, TILE - 6).fill(0x1d2833);
  }
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
