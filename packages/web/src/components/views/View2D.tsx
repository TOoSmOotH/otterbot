import { useEffect, useRef } from "react";
import { useSceneStore } from "../../stores/scene-store";

/**
 * Top-down 2D visualization of the active scene. Draws floor tiles, walls
 * as grey rectangles, zones as dashed outlines, and a dot for the agent.
 * A lightweight substitute for the old PixelCanvas renderer until we need
 * full agent motion again.
 */
export function View2D() {
  const load = useSceneStore((s) => s.load);
  const activeScene = useSceneStore((s) => s.activeScene());
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeScene) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "rgb(18, 18, 22)";
      ctx.fillRect(0, 0, w, h);

      // Camera: fit scene bounds to canvas, y-up
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of activeScene.props) {
        minX = Math.min(minX, p.position[0] - 1);
        maxX = Math.max(maxX, p.position[0] + 1);
        minZ = Math.min(minZ, p.position[2] - 1);
        maxZ = Math.max(maxZ, p.position[2] + 1);
      }
      if (!isFinite(minX)) {
        minX = -10; maxX = 10; minZ = -10; maxZ = 10;
      }
      const pad = 20 * dpr;
      const sceneW = maxX - minX || 1;
      const sceneH = maxZ - minZ || 1;
      const scale = Math.min((w - pad * 2) / sceneW, (h - pad * 2) / sceneH);
      const ox = pad + (w - pad * 2 - sceneW * scale) / 2 - minX * scale;
      const oy = pad + (h - pad * 2 - sceneH * scale) / 2 - minZ * scale;
      const tx = (x: number) => ox + x * scale;
      const ty = (z: number) => oy + z * scale;

      // Props
      ctx.fillStyle = "#333";
      for (const p of activeScene.props) {
        const x = tx(p.position[0]);
        const y = ty(p.position[2]);
        ctx.fillRect(x - 0.5 * scale, y - 0.5 * scale, scale, scale);
      }

      // Zones
      ctx.strokeStyle = "#6388ff";
      ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      for (const z of activeScene.zones ?? []) {
        const zx = tx(z.position[0]) - (z.size[0] * scale) / 2;
        const zy = ty(z.position[2]) - (z.size[2] * scale) / 2;
        ctx.strokeRect(zx, zy, z.size[0] * scale, z.size[2] * scale);
        ctx.fillStyle = "#6388ff";
        ctx.setLineDash([]);
        ctx.font = `${11 * dpr}px sans-serif`;
        ctx.fillText(z.name, zx + 4 * dpr, zy + 14 * dpr);
        ctx.setLineDash([6 * dpr, 4 * dpr]);
      }
      ctx.setLineDash([]);

      // Agent dot at scene origin (COO)
      const agentX = tx(0);
      const agentY = ty(0);
      ctx.fillStyle = "#4ade80";
      ctx.beginPath();
      ctx.arc(agentX, agentY, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `${11 * dpr}px sans-serif`;
      ctx.fillText("otterbot", agentX + 10 * dpr, agentY + 4 * dpr);
    };

    draw();
    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [activeScene]);

  if (!activeScene) {
    return (
      <div style={{ padding: 16, color: "rgb(var(--muted))" }} data-testid="view-2d-empty">
        Loading scene…
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%" }} data-testid="view-2d">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
