import type { AgentPosition } from "../../../hooks/use-agent-positions";
import type { SceneZone } from "@otterbot/shared";
import type { Camera2D } from "./camera";
import { drawGrid } from "./draw-grid";
import { drawZones } from "./draw-zones";
import { drawAgents } from "./draw-agents";

export interface RenderState {
  positions: AgentPosition[];
  zones: SceneZone[];
  agentScreenPositions: Map<string, { x: number; z: number }>;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera2D,
  w: number,
  h: number,
  state: RenderState,
  time: number,
) {
  // 1. Clear + background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a0a0a");
  grad.addColorStop(1, "#1a1a2e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 2. Grid floor
  drawGrid(ctx, cam, w, h);

  // 3. Zones
  if (state.zones.length > 0) {
    drawZones(ctx, cam, w, h, state.zones);
  }

  // 4. Agents (shadows + sprites + labels)
  drawAgents(ctx, cam, w, h, state.positions, state.agentScreenPositions, time);
}
