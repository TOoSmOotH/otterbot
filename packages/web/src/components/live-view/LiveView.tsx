import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { LiveViewScene } from "./LiveViewScene";

interface LiveViewProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null };
  onToggleView?: () => void;
}

export function LiveView({ userProfile, onToggleView }: LiveViewProps) {
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const loadEnvironment = useEnvironmentStore((s) => s.loadEnvironment);

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

      {/* 3D Canvas */}
      <div className="flex-1">
        <Canvas
          shadows
          camera={{ position: [0, 5, 12], fov: 50 }}
          style={{ background: "linear-gradient(180deg, #0a0a0a 0%, #1a1a2e 100%)" }}
        >
          <LiveViewScene userProfile={userProfile} />
        </Canvas>
      </div>
    </div>
  );
}
