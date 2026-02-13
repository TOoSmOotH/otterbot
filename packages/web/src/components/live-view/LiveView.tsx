import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { LiveViewScene } from "./LiveViewScene";
import { RoomBuilderToolbar } from "../room-builder/RoomBuilderToolbar";
import { AssetPalette } from "../room-builder/AssetPalette";
import { PropInspector } from "../room-builder/PropInspector";
import { useRoomBuilderKeys } from "../../hooks/use-room-builder-keys";

interface LiveViewProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null };
  onToggleView?: () => void;
}

export function LiveView({ userProfile, onToggleView }: LiveViewProps) {
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const loadEnvironment = useEnvironmentStore((s) => s.loadEnvironment);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const builderActive = useRoomBuilderStore((s) => s.active);
  const enterEditMode = useRoomBuilderStore((s) => s.enterEditMode);
  const selectProp = useRoomBuilderStore((s) => s.selectProp);

  useRoomBuilderKeys();

  useEffect(() => {
    loadPacks();
    loadEnvironment();
  }, [loadPacks, loadEnvironment]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">Live View</h2>
        <div className="flex items-center gap-2">
          {activeScene && !builderActive && (
            <button
              onClick={() => enterEditMode(activeScene)}
              title="Edit Room"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
            >
              {/* Pencil icon */}
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
          )}
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

      {/* 3D Canvas + overlays */}
      <div className="flex-1 relative">
        <Canvas
          shadows
          camera={{ position: [0, 5, 12], fov: 50 }}
          style={{ background: "linear-gradient(180deg, #0a0a0a 0%, #1a1a2e 100%)" }}
          onPointerMissed={() => {
            if (builderActive) selectProp(null);
          }}
        >
          <LiveViewScene userProfile={userProfile} />
        </Canvas>

        {/* Room builder overlays */}
        {builderActive && (
          <>
            <RoomBuilderToolbar />
            <AssetPalette />
            <PropInspector />
          </>
        )}
      </div>
    </div>
  );
}
