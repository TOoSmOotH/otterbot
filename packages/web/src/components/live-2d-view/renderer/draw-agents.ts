import type { AgentPosition } from "../../../hooks/use-agent-positions";
import type { Camera2D } from "./camera";
import { worldToScreen } from "./camera";
import { ROLE_COLORS, STATUS_COLORS, NAME_FONT } from "./colors";
import { getSprite } from "./sprites";

const SPRITE_SCALE = 3;
const SPRITE_SIZE = 16 * SPRITE_SCALE; // 48px on screen

export function drawAgents(
  ctx: CanvasRenderingContext2D,
  cam: Camera2D,
  w: number,
  h: number,
  positions: AgentPosition[],
  agentScreenPositions: Map<string, { x: number; z: number }>,
  time: number,
) {
  for (const pos of positions) {
    const agentId = pos.agent?.id ?? "ceo";
    const status = pos.agent?.status ?? "idle";
    const roleColor = ROLE_COLORS[pos.role] ?? ROLE_COLORS.worker;
    const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;

    // Use override position from movement store if available
    const overridePos = agentScreenPositions.get(agentId);
    const worldX = overridePos?.x ?? pos.x;
    const worldZ = overridePos?.z ?? pos.z;

    const [sx, sy] = worldToScreen(cam, w, h, worldX, worldZ);

    // Idle bob animation
    const bob = Math.sin(time * 0.003 + (pos.agent?.id?.charCodeAt(0) ?? 0)) * 1.5;

    // Shadow ellipse
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + SPRITE_SIZE / 2 - 2, SPRITE_SIZE / 3, SPRITE_SIZE / 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Draw sprite
    const isMoving = overridePos !== undefined;
    const frame = isMoving ? (Math.floor(time * 0.005) % 2) : 0;
    const sprite = getSprite(roleColor, frame);
    ctx.drawImage(
      sprite,
      sx - SPRITE_SIZE / 2,
      sy - SPRITE_SIZE / 2 + bob - SPRITE_SIZE / 4,
      SPRITE_SIZE,
      SPRITE_SIZE,
    );

    // Status dot above head
    const dotY = sy - SPRITE_SIZE / 2 + bob - SPRITE_SIZE / 4 - 6;
    const dotSize = 3;

    // Thinking agents: pulse the dot
    if (status === "thinking") {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
      ctx.globalAlpha = 0.5 + 0.5 * pulse;
    }

    ctx.fillStyle = statusColor;
    ctx.fillRect(sx - dotSize / 2, dotY - dotSize / 2, dotSize, dotSize);
    ctx.globalAlpha = 1;

    // Name label below sprite
    ctx.font = NAME_FONT;
    ctx.fillStyle = "#cccccc";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(pos.label, sx, sy + SPRITE_SIZE / 2 + 2);
  }
}
