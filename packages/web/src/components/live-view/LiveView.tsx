import { useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { LiveViewScene } from "./LiveViewScene";
import { RoomBuilderToolbar } from "../room-builder/RoomBuilderToolbar";
import { AssetPalette } from "../room-builder/AssetPalette";
import { PropInspector } from "../room-builder/PropInspector";
import { WaypointInspector } from "../room-builder/WaypointInspector";
import { useRoomBuilderKeys } from "../../hooks/use-room-builder-keys";

interface LiveViewProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null; cooName?: string };
  onToggleView?: () => void;
}

export function LiveView({ userProfile, onToggleView }: LiveViewProps) {
  const loadPacks = useModelPackStore((s) => s.loadPacks);
  const loadEnvironment = useEnvironmentStore((s) => s.loadEnvironment);
  const reloadEnvironment = useEnvironmentStore((s) => s.reloadEnvironment);
  const scenes = useEnvironmentStore((s) => s.scenes);
  const activeSceneId = useEnvironmentStore((s) => s.activeSceneId);
  const setActiveSceneId = useEnvironmentStore((s) => s.setActiveSceneId);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const builderActive = useRoomBuilderStore((s) => s.active);
  const builderDirty = useRoomBuilderStore((s) => s.dirty);
  const enterEditMode = useRoomBuilderStore((s) => s.enterEditMode);
  const exitEditMode = useRoomBuilderStore((s) => s.exitEditMode);
  const selectProp = useRoomBuilderStore((s) => s.selectProp);
  const importFileRef = useRef<HTMLInputElement>(null);

  useRoomBuilderKeys();

  useEffect(() => {
    loadPacks();
    loadEnvironment();
  }, [loadPacks, loadEnvironment]);

  const handleSceneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    if (newId === activeSceneId) return;
    if (builderActive && builderDirty) {
      if (!window.confirm("You have unsaved changes. Discard and switch scenes?")) return;
      exitEditMode();
    } else if (builderActive) {
      exitEditMode();
    }
    setActiveSceneId(newId);
  };

  const handleImportClick = () => {
    if (builderActive && builderDirty) {
      if (!window.confirm("You have unsaved changes. Discard and import a scene?")) return;
      exitEditMode();
    } else if (builderActive) {
      exitEditMode();
    }
    importFileRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate shape
      if (
        !data ||
        typeof data.id !== "string" ||
        typeof data.name !== "string" ||
        !Array.isArray(data.props) ||
        !data.props.every(
          (p: unknown) =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as Record<string, unknown>).asset === "string" &&
            Array.isArray((p as Record<string, unknown>).position) &&
            ((p as Record<string, unknown>).position as unknown[]).length === 3 &&
            ((p as Record<string, unknown>).position as number[]).every(
              (n: unknown) => typeof n === "number",
            ),
        )
      ) {
        window.alert(
          'Invalid scene file. Expected a JSON object with "id" (string), "name" (string), and a "props" array where each entry has an "asset" string and a "position" array of 3 numbers.',
        );
        return;
      }

      // Warn if overwriting an existing scene
      const existing = scenes.find((s) => s.id === data.id);
      if (existing) {
        if (!window.confirm(`A scene with id "${data.id}" already exists. Overwrite it?`)) return;
      }

      // Save to server
      const res = await fetch(`/api/scenes/${data.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save imported scene");

      await reloadEnvironment();
      setActiveSceneId(data.id);
    } catch (err) {
      if (err instanceof SyntaxError) {
        window.alert("Failed to parse the scene file as JSON.");
      } else if (err instanceof Error) {
        window.alert(err.message);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold tracking-tight">Live View</h2>
        <div className="flex items-center gap-2">
          {/* Scene selector */}
          <select
            value={activeSceneId}
            onChange={handleSceneChange}
            className="text-xs bg-secondary border border-border rounded px-2 py-1 text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="world-base">Office World</option>
            {scenes.filter((s) => s.id !== "default-office" && s.id !== "world-base").map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Import button */}
          <button
            onClick={handleImportClick}
            title="Import Scene"
            className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
          >
            {/* Upload icon */}
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />

          {/* Edit button (hidden when already editing) */}
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
            <RoomBuilderInspector />
          </>
        )}
      </div>
    </div>
  );
}

function RoomBuilderInspector() {
  const editorTool = useRoomBuilderStore((s) => s.editorTool);

  if (editorTool === "waypoints") {
    return <WaypointInspector />;
  }

  return <PropInspector />;
}
