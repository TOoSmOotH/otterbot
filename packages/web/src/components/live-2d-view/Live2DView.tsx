import { useState, useMemo, useEffect, useRef } from "react";
import { useAgentPositions } from "../../hooks/use-agent-positions";
import { useMovementStore } from "../../stores/movement-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { PixelCanvas } from "./PixelCanvas";
import { createCamera, fitToRect } from "./renderer/camera";
import type { Camera2D } from "./renderer/camera";
import type { RenderState } from "./renderer/render-loop";

interface Live2DViewProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null; gearConfig?: Record<string, boolean> | null; cooName?: string };
  onToggleView?: () => void;
}

export function Live2DView({ userProfile, onToggleView }: Live2DViewProps) {
  const positions = useAgentPositions(userProfile);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const zones = activeScene?.zones ?? [];
  const [camera, setCamera] = useState<Camera2D>(createCamera);
  const fittedRef = useRef(false);

  // Auto-fit camera to show all zones on first load
  useEffect(() => {
    if (fittedRef.current) return;
    if (zones.length === 0 && positions.length === 0) return;
    fittedRef.current = true;

    // Compute bounding box of all zones + agent positions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const zone of zones) {
      const [px, , pz] = zone.position;
      const [sx, , sz] = zone.size;
      minX = Math.min(minX, px - sx / 2);
      maxX = Math.max(maxX, px + sx / 2);
      minY = Math.min(minY, pz - sz / 2);
      maxY = Math.max(maxY, pz + sz / 2);
    }

    for (const pos of positions) {
      minX = Math.min(minX, pos.x - 1);
      maxX = Math.max(maxX, pos.x + 1);
      minY = Math.min(minY, pos.z - 1);
      maxY = Math.max(maxY, pos.z + 1);
    }

    if (isFinite(minX)) {
      // Use a reasonable default canvas size for fit calculation
      setCamera(fitToRect(800, 600, minX, minY, maxX, maxY));
    }
  }, [zones, positions]);

  // Get movement-override positions for agents currently walking
  const movementPositions = useMovementStore((s) => s.movements);
  const agentScreenPositions = useMemo(() => {
    const map = new Map<string, { x: number; z: number }>();
    for (const [agentId, entry] of movementPositions) {
      if (!entry.interpolator.finished) {
        map.set(agentId, { x: entry.state.position[0], z: entry.state.position[2] });
      }
    }
    return map;
  }, [movementPositions]);

  // Tick movement store in an animation frame since we're not inside R3F
  useEffect(() => {
    let lastTime = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000;
      lastTime = now;
      useMovementStore.getState().tick(delta);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const renderState: RenderState = useMemo(
    () => ({ positions, zones, agentScreenPositions }),
    [positions, zones, agentScreenPositions],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">2D View</h2>
        <div className="flex items-center gap-2">
          {onToggleView && (
            <button
              onClick={onToggleView}
              title="Switch to Agent Graph"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <PixelCanvas camera={camera} onCameraChange={setCamera} renderState={renderState} />
      </div>
    </div>
  );
}
