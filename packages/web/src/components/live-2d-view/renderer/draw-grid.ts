import type { Camera2D } from "./camera";
import { worldToScreen } from "./camera";
import { GRID_COLOR, GRID_LINE_COLOR } from "./colors";

export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera2D, w: number, h: number) {
  // Determine grid spacing in world units (adaptive to zoom)
  let spacing = 1;
  if (cam.zoom < 20) spacing = 5;
  if (cam.zoom < 10) spacing = 10;

  // Visible world range
  const [minWx, minWy] = [(0 - w / 2) / cam.zoom + cam.x, (0 - h / 2) / cam.zoom + cam.y];
  const [maxWx, maxWy] = [(w - w / 2) / cam.zoom + cam.x, (h - h / 2) / cam.zoom + cam.y];

  const startX = Math.floor(minWx / spacing) * spacing;
  const startY = Math.floor(minWy / spacing) * spacing;

  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;

  // Vertical lines
  for (let wx = startX; wx <= maxWx; wx += spacing) {
    const [sx] = worldToScreen(cam, w, h, wx, 0);
    ctx.beginPath();
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, h);
    ctx.stroke();
  }

  // Horizontal lines
  for (let wy = startY; wy <= maxWy; wy += spacing) {
    const [, sy] = worldToScreen(cam, w, h, 0, wy);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(w, Math.round(sy) + 0.5);
    ctx.stroke();
  }

  // Major grid lines (every 5 units)
  const majorSpacing = spacing * 5;
  ctx.strokeStyle = GRID_COLOR;
  const majorStartX = Math.floor(minWx / majorSpacing) * majorSpacing;
  const majorStartY = Math.floor(minWy / majorSpacing) * majorSpacing;

  for (let wx = majorStartX; wx <= maxWx; wx += majorSpacing) {
    const [sx] = worldToScreen(cam, w, h, wx, 0);
    ctx.beginPath();
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, h);
    ctx.stroke();
  }

  for (let wy = majorStartY; wy <= maxWy; wy += majorSpacing) {
    const [, sy] = worldToScreen(cam, w, h, 0, wy);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(w, Math.round(sy) + 0.5);
    ctx.stroke();
  }
}
