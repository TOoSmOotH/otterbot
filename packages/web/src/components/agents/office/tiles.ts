import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { Cell, TILE } from "./geometry";
import type { World } from "./worldLayout";

const C = {
  floor: 0x2b2f3a,
  floorAlt: 0x30343f,
  wall: 0x171a21,
  wallTop: 0x3a4254,
  door: 0x5a4636,
  deskTop: 0x6a513c,
  deskEdge: 0x3c2f24,
  plant: 0x3f8f5a,
  printer: 0xb9bec8,
};

// Sprite names from public/office/roguelike.xml (Kenney "Roguelike Modern City",
// CC0). Indices verified against the tilemap. Leave a key unset to keep the
// Graphics drawing for that item.
const ART: Partial<Record<"floor" | "wall" | "door" | "desk" | "plant" | "printer", string>> = {
  floor: "tile_0741.png", // gray tile floor
  wall: "tile_0009.png", // neutral gray stone wall
  door: "tile_0617.png", // wooden paneled door
  desk: "tile_0572.png", // wooden desk
};

let sheet: Texture | null = null;
let frames: Record<string, Rectangle> | null = null;

/** Load the Kenney sheet + parse its XML atlas. Safe to call repeatedly; no-throw. */
export async function loadOfficeAtlas(): Promise<void> {
  if (Object.keys(ART).length === 0) { frames = frames ?? {}; return; }
  if (frames) return;
  try {
    sheet = (await Assets.load("/office/roguelike.png")) as Texture;
    const xml = await (await fetch("/office/roguelike.xml")).text();
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

  for (let ty = 0; ty < world.rows; ty++) {
    for (let tx = 0; tx < world.cols; tx++) {
      const cell = world.grid[ty * world.cols + tx] as Cell;
      const x = tx * TILE;
      const y = ty * TILE;
      switch (cell) {
        case Cell.WALL: {
          const wallSprite = artSprite("wall");
          if (wallSprite) {
            wallSprite.x = x;
            wallSprite.y = y;
            root.addChild(wallSprite);
          } else {
            g.rect(x, y, TILE, TILE).fill(C.wall);
            g.rect(x, y, TILE, 4).fill(C.wallTop);
          }
          break;
        }
        case Cell.DOOR: {
          const doorFloor = artSprite("floor");
          if (doorFloor) {
            doorFloor.x = x;
            doorFloor.y = y;
            root.addChild(doorFloor);
          } else {
            g.rect(x, y, TILE, TILE).fill(C.floor);
          }
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
          const base = artSprite("floor");
          if (base) {
            base.x = x;
            base.y = y;
            root.addChild(base);
          } else {
            g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
          }
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
        default: {
          const floorSprite = artSprite("floor");
          if (floorSprite) {
            floorSprite.x = x;
            floorSprite.y = y;
            root.addChild(floorSprite);
          } else {
            g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
          }
        }
      }
    }
  }
  return root;
}

/** A simple potted-plant prop at a tile. */
export function drawPlant(tx: number, ty: number): Graphics {
  const g = new Graphics();
  g.rect(tx * TILE + 5, ty * TILE + 9, 6, 5).fill(0x8a5a3c);
  g.circle(tx * TILE + 8, ty * TILE + 6, 5).fill(C.plant);
  return g;
}

/** A simple printer prop at a tile. */
export function drawPrinter(tx: number, ty: number): Graphics {
  const g = new Graphics();
  g.rect(tx * TILE + 3, ty * TILE + 5, 10, 8).fill(C.printer);
  g.rect(tx * TILE + 5, ty * TILE + 3, 6, 3).fill(0x8b93a3);
  return g;
}
