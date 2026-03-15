import type { SceneZone } from "@otterbot/shared";
import type { Camera2D } from "./camera";
import { worldToScreen } from "./camera";
import { ROLE_COLORS, LABEL_FONT } from "./colors";

export function drawZones(ctx: CanvasRenderingContext2D, cam: Camera2D, w: number, h: number, zones: SceneZone[]) {
  for (const zone of zones) {
    const [px, , pz] = zone.position;
    const [sx, , sz] = zone.size;

    // Zone in world coords: center at (px, pz), size (sx, sz)
    // Top-down: world x → screen x, world z → screen y
    const minX = px - sx / 2;
    const minY = pz - sz / 2;
    const maxX = px + sx / 2;
    const maxY = pz + sz / 2;

    const [screenMinX, screenMinY] = worldToScreen(cam, w, h, minX, minY);
    const [screenMaxX, screenMaxY] = worldToScreen(cam, w, h, maxX, maxY);

    const rectX = screenMinX;
    const rectY = screenMinY;
    const rectW = screenMaxX - screenMinX;
    const rectH = screenMaxY - screenMinY;

    // Fill with semi-transparent color
    const borderColor = zone.borderColor ?? ROLE_COLORS.worker ?? "#06b6d4";
    ctx.fillStyle = borderColor + "15";
    ctx.fillRect(rectX, rectY, rectW, rectH);

    // Dithered border
    drawDitheredRect(ctx, rectX, rectY, rectW, rectH, borderColor + "60");

    // Zone name label
    ctx.font = LABEL_FONT;
    ctx.fillStyle = borderColor + "cc";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(zone.name, rectX + rectW / 2, rectY + 4);
  }
}

function drawDitheredRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  const step = 2;

  // Top and bottom edges
  for (let px = Math.round(x); px < x + w; px += step) {
    ctx.fillRect(px, Math.round(y), 1, 1);
    ctx.fillRect(px, Math.round(y + h - 1), 1, 1);
  }

  // Left and right edges
  for (let py = Math.round(y); py < y + h; py += step) {
    ctx.fillRect(Math.round(x), py, 1, 1);
    ctx.fillRect(Math.round(x + w - 1), py, 1, 1);
  }
}
