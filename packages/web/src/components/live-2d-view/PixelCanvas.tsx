import { useEffect, useRef, useCallback } from "react";
import type { Camera2D } from "./renderer/camera";
import { zoomAt, pan } from "./renderer/camera";
import type { RenderState } from "./renderer/render-loop";
import { renderFrame } from "./renderer/render-loop";

interface PixelCanvasProps {
  camera: Camera2D;
  onCameraChange: (cam: Camera2D) => void;
  renderState: RenderState;
}

export function PixelCanvas({ camera, onCameraChange, renderState }: PixelCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const draggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  // Keep latest values in refs so the RAF loop doesn't need to re-attach
  const cameraRef = useRef(camera);
  const stateRef = useRef(renderState);
  cameraRef.current = camera;
  stateRef.current = renderState;

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.imageSmoothingEnabled = false;
    }
  }, []);

  useEffect(() => {
    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resize]);

  // RAF loop
  useEffect(() => {
    const loop = (time: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const rect = container.getBoundingClientRect();
      // Reset transform before drawing
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
      ctx.imageSmoothingEnabled = false;

      renderFrame(ctx, cameraRef.current, rect.width, rect.height, stateRef.current, time);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      onCameraChange(zoomAt(cameraRef.current, rect.width, rect.height, sx, sy, factor));
    },
    [onCameraChange],
  );

  // Pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.clientX - lastMouseRef.current.x;
      const dy = e.clientY - lastMouseRef.current.y;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      onCameraChange(pan(cameraRef.current, dx, dy));
    },
    [onCameraChange],
  );

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden" style={{ cursor: draggingRef.current ? "grabbing" : "grab" }}>
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
