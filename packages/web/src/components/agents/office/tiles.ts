import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { TILE } from "./geometry";
import { buildOfficeMap, type OfficeObject, type TileLayer } from "./officeMap";
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
const CHARACTER_ATLAS_IMAGE = "/office/generated/office-characters-transparent.png";
const CHARACTER_ATLAS_JSON = "/office/generated/office-characters.json";
const PROP_ATLAS_IMAGE = "/office/generated/office-props-transparent.png";
const PROP_ATLAS_JSON = "/office/generated/office-props.json";
const CHARACTER_FRAME_NAMES = [
  "worker_01_black_hair_blue",
  "worker_02_brown_hair_green",
  "worker_03_blond_white",
  "worker_04_blue_hair_purple",
  "worker_05_bun_teal",
  "worker_06_red_hair_rust",
  "worker_07_black_hair_gray",
  "worker_08_orange_hair_blue",
  "worker_09_white_hair_gold",
  "worker_10_purple_hair_gold",
  "worker_11_long_brown_hair_pink",
  "worker_12_blond_ponytail_cyan",
];

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
let characterSheet: Texture | null = null;
let characterFrames: Record<string, Rectangle> | null = null;
let propSheet: Texture | null = null;
let propFrames: Record<string, Rectangle> | null = null;

/** Load the first-party office sheet + parse its generated JSON atlas. Safe to call repeatedly; no-throw. */
export async function loadOfficeAtlas(): Promise<void> {
  if (frames && characterFrames && propFrames) return;
  try {
    const office = await loadGeneratedAtlas(ATLAS_IMAGE, ATLAS_JSON);
    sheet = office.sheet;
    frames = office.frames;
  } catch {
    frames = {}; // atlas unavailable -> Graphics fallback everywhere
  }
  try {
    const characters = await loadGeneratedAtlas(CHARACTER_ATLAS_IMAGE, CHARACTER_ATLAS_JSON);
    characterSheet = characters.sheet;
    characterFrames = characters.frames;
  } catch {
    characterFrames = {};
  }
  try {
    const props = await loadGeneratedAtlas(PROP_ATLAS_IMAGE, PROP_ATLAS_JSON);
    propSheet = props.sheet;
    propFrames = props.frames;
  } catch {
    propFrames = {};
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

async function loadGeneratedAtlas(imageUrl: string, jsonUrl: string): Promise<{ sheet: Texture; frames: Record<string, Rectangle> }> {
  const loadedSheet = (await Assets.load(imageUrl)) as Texture;
  const atlas = (await (await fetch(jsonUrl)).json()) as {
    frames?: Record<string, { x: number; y: number; w: number; h: number }>;
  };
  const loadedFrames: Record<string, Rectangle> = {};
  for (const [name, frame] of Object.entries(atlas.frames ?? {})) {
    loadedFrames[name] = new Rectangle(frame.x, frame.y, frame.w, frame.h);
  }
  return { sheet: loadedSheet, frames: loadedFrames };
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

function placeGeneratedSprite(
  root: Container,
  sourceSheet: Texture | null,
  sourceFrames: Record<string, Rectangle> | null,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: "contain" | "stretch" = "contain"
): boolean {
  const frame = sourceFrames?.[name];
  if (!sourceSheet || !frame) return false;
  const sprite = new Sprite(new Texture({ source: sourceSheet.source, frame }));
  if (fit === "stretch") {
    sprite.x = Math.round(x);
    sprite.y = Math.round(y);
    sprite.width = Math.round(w);
    sprite.height = Math.round(h);
  } else {
    const scale = Math.min(w / sprite.texture.width, h / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.x = Math.round(x + (w - sprite.texture.width * scale) / 2);
    sprite.y = Math.round(y + (h - sprite.texture.height * scale) / 2);
  }
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
  const officeMap = buildOfficeMap(world);
  const root = new Container();
  const floorLayer = new Container();
  const g = new Graphics();
  root.addChild(floorLayer, g);

  drawStudioFloor(floorLayer, g, world);
  drawRoomRugs(root, g, world);
  drawRoomShells(g, world);
  drawTileLayer(root, g, officeMap.tileLayer);
  drawObjects(root, g, officeMap.objects);
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

    g.rect(x - 2, y - 8, 3, h + 14).fill(0xb48355);
    g.rect(x + w - 1, y - 8, 3, h + 14).fill(0xb48355);
  }
}

function drawTileLayer(root: Container, g: Graphics, layer: TileLayer): void {
  for (let ty = 0; ty < layer.rows; ty++) {
    for (let tx = 0; tx < layer.cols; tx++) {
      const tile = layer.tiles[ty * layer.cols + tx];
      if (tile === "wall") drawWall(root, g, tx, ty, layer);
      if (tile === "door") drawDoor(root, g, tx, ty);
    }
  }
}

function drawObjects(root: Container, g: Graphics, objects: OfficeObject[]): void {
  for (const object of objects) {
    switch (object.kind) {
      case "sprite":
        drawObjectSprite(root, object);
        break;
      case "desk":
        drawDeskPod(root, g, object.x, object.y, object.w, object.h, true);
        break;
      case "worker":
        drawSeatedWorker(root, g, object.agentId ?? "", object.x, object.y, object.w, object.h);
        break;
      default:
        break;
    }
  }
}

function drawObjectSprite(root: Container, object: OfficeObject): void {
  if (!object.atlas || !object.name) return;
  if (object.atlas === "office") {
    placeSpriteByName(root, object.name, object.x, object.y, object.w, object.h, object.fit);
  } else if (object.atlas === "props") {
    placeGeneratedSprite(root, propSheet, propFrames, object.name, object.x, object.y, object.w, object.h, object.fit);
  }
}

function drawDoor(root: Container, g: Graphics, tx: number, ty: number): void {
  const x = tx * TILE;
  const y = ty * TILE;
  if (!placeSprite(root, "door", x - 13, y - 39, 50, 68)) {
    g.rect(x + 3, y, TILE - 6, TILE).fill(C.door);
  }
}

function drawWall(root: Container, g: Graphics, tx: number, ty: number, layer: TileLayer): void {
  const x = tx * TILE;
  const y = ty * TILE;
  const at = (nx: number, ny: number) =>
    nx >= 0 && ny >= 0 && nx < layer.cols && ny < layer.rows ? layer.tiles[ny * layer.cols + nx] : "wall";
  const horiz = at(tx - 1, ty) === "wall" || at(tx + 1, ty) === "wall";
  const frontGlass = horiz && at(tx, ty - 1) !== "wall" && at(tx, ty + 1) !== "wall";

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

function drawDeskPod(root: Container, g: Graphics, x: number, y: number, w: number, h: number, occupied: boolean): void {
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

function drawSeatedWorker(root: Container, g: Graphics, agentId: string, x: number, y: number, w: number, h: number): void {
  const frame = CHARACTER_FRAME_NAMES[Math.abs(hashString(agentId)) % CHARACTER_FRAME_NAMES.length];
  if (placeGeneratedSprite(root, characterSheet, characterFrames, frame, x, y, w, h)) return;

  g.roundRect(x + 4, y + 26, w - 10, h * 0.5, 5).fill(0x151b24);
  g.circle(x + w / 2, y + 20, 12).fill(0xc9895d);
  g.rect(x + 9, y + 11, w - 18, 10).fill(0x1d1716);
  g.rect(x + 6, y + 32, w - 12, 18).fill(0x263241);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function placeSpriteByName(
  root: Container,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: "contain" | "stretch" = "contain"
): boolean {
  const frame = frames?.[name];
  if (!sheet || !frame) return false;
  const sprite = new Sprite(new Texture({ source: sheet.source, frame }));
  if (fit === "stretch") {
    sprite.x = Math.round(x);
    sprite.y = Math.round(y);
    sprite.width = Math.round(w);
    sprite.height = Math.round(h);
  } else {
    const scale = Math.min(w / sprite.texture.width, h / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.x = Math.round(x + (w - sprite.texture.width * scale) / 2);
    sprite.y = Math.round(y + (h - sprite.texture.height * scale) / 2);
  }
  root.addChild(sprite);
  return true;
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
