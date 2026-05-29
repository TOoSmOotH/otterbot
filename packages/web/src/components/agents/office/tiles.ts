import { Container, Graphics } from "pixi.js";
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
        case Cell.WALL:
          g.rect(x, y, TILE, TILE).fill(C.wall);
          g.rect(x, y, TILE, 4).fill(C.wallTop);
          break;
        case Cell.DOOR:
          g.rect(x, y, TILE, TILE).fill(C.floor);
          g.rect(x + 3, y, TILE - 6, TILE).fill(C.door);
          break;
        case Cell.DESK:
          g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
          g.rect(x + 1, y + 3, TILE - 2, TILE - 5).fill(C.deskTop);
          g.rect(x + 1, y + TILE - 4, TILE - 2, 3).fill(C.deskEdge);
          break;
        default:
          g.rect(x, y, TILE, TILE).fill((tx + ty) % 2 ? C.floor : C.floorAlt);
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
