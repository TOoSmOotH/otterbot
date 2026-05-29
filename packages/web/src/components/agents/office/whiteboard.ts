import { Container, Graphics, Text } from "pixi.js";
import { TILE } from "./geometry";
import type { PipelineRun } from "../../../stores/projects-store";

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
  const w = wTiles * TILE;
  const h = TILE - 2;
  root.x = tx * TILE;
  root.y = ty * TILE + 1;

  const bg = new Graphics().roundRect(0, 0, w, h, 2).fill(0xe9ead2).stroke({ width: 1, color: 0x11141a });
  root.addChild(bg);

  if (!run) {
    const t = new Text({ text: "No runs yet", style: { fontSize: 7, fill: 0x6a6a55 } });
    t.x = 4;
    t.y = h / 2 - 4;
    root.addChild(t);
    return root;
  }

  const goal = run.goal.length > 22 ? run.goal.slice(0, 22) + "…" : run.goal;
  const title = new Text({ text: goal, style: { fontSize: 7, fill: 0x3a3a2a, fontWeight: "700" } });
  title.x = 4;
  title.y = 2;
  root.addChild(title);

  let cx = 4;
  for (const st of run.stages) {
    const color = STAGE_HEX[st.status] ?? STAGE_HEX.pending;
    const dot = new Graphics().circle(cx + 3, h - 5, 3).fill(color);
    root.addChild(dot);
    cx += 9;
  }
  return root;
}
