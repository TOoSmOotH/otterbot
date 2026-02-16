import { useRoomBuilderStore } from "../../stores/room-builder-store";

export function RoomBuilderToolbar() {
  const transformMode = useRoomBuilderStore((s) => s.transformMode);
  const setTransformMode = useRoomBuilderStore((s) => s.setTransformMode);
  const snapEnabled = useRoomBuilderStore((s) => s.snapEnabled);
  const toggleSnap = useRoomBuilderStore((s) => s.toggleSnap);
  const selectedPropUid = useRoomBuilderStore((s) => s.selectedPropUid);
  const deleteProp = useRoomBuilderStore((s) => s.deleteProp);
  const undo = useRoomBuilderStore((s) => s.undo);
  const redo = useRoomBuilderStore((s) => s.redo);
  const history = useRoomBuilderStore((s) => s.history);
  const future = useRoomBuilderStore((s) => s.future);
  const dirty = useRoomBuilderStore((s) => s.dirty);
  const saving = useRoomBuilderStore((s) => s.saving);
  const saveScene = useRoomBuilderStore((s) => s.saveScene);
  const exportScene = useRoomBuilderStore((s) => s.exportScene);
  const exitEditMode = useRoomBuilderStore((s) => s.exitEditMode);
  const editorTool = useRoomBuilderStore((s) => s.editorTool);
  const setEditorTool = useRoomBuilderStore((s) => s.setEditorTool);
  const waypointTool = useRoomBuilderStore((s) => s.waypointTool);
  const setWaypointTool = useRoomBuilderStore((s) => s.setWaypointTool);
  const selectedWaypointId = useRoomBuilderStore((s) => s.selectedWaypointId);
  const deleteWaypoint = useRoomBuilderStore((s) => s.deleteWaypoint);

  const handleExit = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    exitEditMode();
  };

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-card/90 backdrop-blur-sm border border-border rounded-lg px-2 py-1.5 shadow-lg">
      {/* Editor mode toggle */}
      <ToolbarGroup>
        <ToolbarButton
          active={editorTool === "props"}
          onClick={() => setEditorTool("props")}
          title="Props Mode"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={editorTool === "waypoints"}
          onClick={() => setEditorTool("waypoints")}
          title="Waypoints Mode"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="18" r="3" />
            <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
          </svg>
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Waypoint tools (only shown in waypoint mode) */}
      {editorTool === "waypoints" && (
        <>
          <ToolbarGroup>
            <ToolbarButton
              active={waypointTool === "select"}
              onClick={() => setWaypointTool("select")}
              title="Select Waypoint"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
              </svg>
            </ToolbarButton>
            <ToolbarButton
              active={waypointTool === "add"}
              onClick={() => setWaypointTool("add")}
              title="Add Waypoint"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </ToolbarButton>
            <ToolbarButton
              active={waypointTool === "connect"}
              onClick={() => setWaypointTool("connect")}
              title="Connect Waypoints"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="5" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
                <line x1="7" y1="12" x2="17" y2="12" />
              </svg>
            </ToolbarButton>
            <ToolbarButton
              active={waypointTool === "delete"}
              onClick={() => setWaypointTool("delete")}
              title="Delete Waypoint"
              danger
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </ToolbarButton>
          </ToolbarGroup>
          <Divider />
        </>
      )}

      {/* Transform mode buttons (only in props mode) */}
      {editorTool === "props" && <ToolbarGroup>
        <ToolbarButton
          active={transformMode === "translate"}
          onClick={() => setTransformMode("translate")}
          title="Move (W)"
        >
          {/* Move icon */}
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="5 9 2 12 5 15" />
            <polyline points="9 5 12 2 15 5" />
            <polyline points="15 19 12 22 9 19" />
            <polyline points="19 9 22 12 19 15" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="12" y1="2" x2="12" y2="22" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={transformMode === "rotate"}
          onClick={() => setTransformMode("rotate")}
          title="Rotate (E)"
        >
          {/* Rotate icon */}
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6" />
            <path d="M21.34 15.57a10 10 0 1 1-.57-8.38" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          active={transformMode === "scale"}
          onClick={() => setTransformMode("scale")}
          title="Scale (R)"
        >
          {/* Scale icon */}
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 3L15 3L15 9" />
            <path d="M3 21L9 21L9 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </ToolbarButton>
      </ToolbarGroup>}

      {editorTool === "props" && <>
      <Divider />

      {/* Snap toggle */}
      <ToolbarButton
        active={snapEnabled}
        onClick={toggleSnap}
        title="Toggle Grid Snap (G)"
      >
        {/* Grid icon */}
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Delete */}
      <ToolbarButton
        disabled={!selectedPropUid}
        onClick={() => selectedPropUid && deleteProp(selectedPropUid)}
        title="Delete (Del)"
        danger
      >
        {/* Trash icon */}
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </ToolbarButton>
      </>}

      <Divider />

      {/* Undo / Redo */}
      <ToolbarGroup>
        <ToolbarButton
          disabled={history.length === 0}
          onClick={undo}
          title="Undo (Ctrl+Z)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </ToolbarButton>
        <ToolbarButton
          disabled={future.length === 0}
          onClick={redo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </ToolbarButton>
      </ToolbarGroup>

      <Divider />

      {/* Save */}
      <ToolbarButton
        disabled={!dirty || saving}
        onClick={saveScene}
        title="Save"
      >
        {saving ? (
          <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="30 60" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
        )}
      </ToolbarButton>

      {/* Export */}
      <ToolbarButton
        onClick={exportScene}
        title="Export Scene"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </ToolbarButton>

      <Divider />

      {/* Exit */}
      <ToolbarButton
        onClick={handleExit}
        title="Exit Edit Mode (Esc)"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </ToolbarButton>
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Divider() {
  return <div className="w-px h-5 bg-border mx-1" />;
}

function ToolbarButton({
  children,
  active,
  disabled,
  danger,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        p-1.5 rounded transition-colors
        ${active
          ? "bg-primary/20 text-primary"
          : danger
            ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
        }
        ${disabled ? "opacity-30 pointer-events-none" : ""}
      `}
    >
      {children}
    </button>
  );
}
