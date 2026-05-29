import { Container, Graphics, Text } from "pixi.js";
import { TILE } from "./geometry";
import type { PipelineRun } from "../../../stores/projects-store";
import { artSprite } from "./tiles";

const STAGE_HEX: Record<string, number> = {
  pass: 0x46c46a,
  fail: 0xe0584a,
  error: 0xe0584a,
  running: 0xe2b13c,
  pending: 0x8b93a3,
};

/** Build a whiteboard graphic for a room's whiteboard strip (tile coords). */
export function drawWhiteboard(
  tx: number,
  ty: number,
  wTiles: number,
  run: PipelineRun | null
): Container {
  const root = new Container();
  const slotW = wTiles * TILE;
  const w = Math.min(slotW, 168);
  const h = 38;
  root.x = tx * TILE + Math.max(0, Math.floor((slotW - w) / 2));
  root.y = ty * TILE + 5;

  const board = artSprite("whiteboard");
  if (board) {
    board.width = w;
    board.height = h;
    root.addChild(board);
  } else {
    const bg = new Graphics()
      .roundRect(0, 0, w, h, 2)
      .fill(0xdfe0cf)
      .stroke({ width: 2, color: 0x20242c });
    root.addChild(bg);
  }

  const rail = new Graphics().rect(8, h - 5, w - 16, 2).fill(0x303742);
  root.addChild(rail);

  if (!run) {
    drawIdleBoard(root, w);
    return root;
  }

  const goal = run.goal.length > 22 ? run.goal.slice(0, 22) + "…" : run.goal;
  const title = new Text({ text: goal, style: { fontSize: 6, fill: 0x303742, fontWeight: "700" } });
  title.x = 10;
  title.y = 7;
  root.addChild(title);

  let cx = 10;
  for (const st of run.stages) {
    if (cx + 8 > w - 8) break;
    const color = STAGE_HEX[st.status] ?? STAGE_HEX.pending;
    const dot = new Graphics().rect(cx, h - 15, 7, 7).fill(color).stroke({ width: 1, color: 0x303742 });
    root.addChild(dot);
    cx += 11;
  }
  return root;
}

function drawIdleBoard(root: Container, w: number): void {
  const ink = new Graphics()
    .moveTo(16, 14)
    .bezierCurveTo(26, 6, 31, 23, 42, 12)
    .stroke({ width: 1, color: 0x7d8790, alpha: 0.7 })
    .moveTo(52, 13)
    .lineTo(72, 13)
    .moveTo(52, 20)
    .lineTo(65, 20)
    .stroke({ width: 1, color: 0x7d8790, alpha: 0.7 });
  root.addChild(ink);

  const colors = [0xf2c14e, 0xe76565, 0x7fc8a9, 0x87a8dc, 0xef9f5f];
  let x = Math.max(82, w - 78);
  for (let i = 0; i < 5; i++) {
    root.addChild(new Graphics().rect(x, 11 + (i % 2) * 10, 7, 7).fill(colors[i]).stroke({ width: 1, color: 0x6f7780 }));
    x += 12;
  }
}
