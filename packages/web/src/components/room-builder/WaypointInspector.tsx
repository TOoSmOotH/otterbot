import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { useEnvironmentStore } from "../../stores/environment-store";

const TAG_OPTIONS = ["", "entrance", "desk", "center", "hallway", "meeting"];

export function WaypointInspector() {
  const waypoints = useRoomBuilderStore((s) => s.editingWaypoints);
  const edges = useRoomBuilderStore((s) => s.editingEdges);
  const selectedId = useRoomBuilderStore((s) => s.selectedWaypointId);
  const updateLabel = useRoomBuilderStore((s) => s.updateWaypointLabel);
  const updateTag = useRoomBuilderStore((s) => s.updateWaypointTag);
  const updateZone = useRoomBuilderStore((s) => s.updateWaypointZone);
  const updatePosition = useRoomBuilderStore((s) => s.updateWaypointPosition);
  const deleteEdge = useRoomBuilderStore((s) => s.deleteEdge);
  const deleteWaypoint = useRoomBuilderStore((s) => s.deleteWaypoint);

  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const zones = activeScene?.zones ?? [];

  const wp = waypoints.find((w) => w.id === selectedId);
  if (!wp) {
    return (
      <div className="p-3 text-sm text-zinc-400">
        Select a waypoint to inspect
      </div>
    );
  }

  // Find edges connected to this waypoint
  const connectedEdges = edges.filter((e) => e.from === wp.id || e.to === wp.id);
  const connectedWaypoints = connectedEdges.map((e) => {
    const otherId = e.from === wp.id ? e.to : e.from;
    const other = waypoints.find((w) => w.id === otherId);
    return { edge: e, otherId, otherLabel: other?.label ?? otherId };
  });

  return (
    <div className="p-3 space-y-3 text-sm">
      <div className="font-medium text-zinc-200">Waypoint: {wp.id}</div>

      {/* Position */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Position</label>
        <div className="flex gap-1">
          {(["X", "Y", "Z"] as const).map((axis, i) => (
            <div key={axis} className="flex-1">
              <label className="text-[10px] text-zinc-500">{axis}</label>
              <input
                type="number"
                step={0.5}
                value={wp.position[i]}
                onChange={(e) => {
                  const pos: [number, number, number] = [...wp.position];
                  pos[i] = parseFloat(e.target.value) || 0;
                  updatePosition(wp.id, pos);
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Label */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Label</label>
        <input
          type="text"
          value={wp.label ?? ""}
          onChange={(e) => updateLabel(wp.id, e.target.value)}
          placeholder="Optional label"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
        />
      </div>

      {/* Tag */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Tag</label>
        <select
          value={wp.tag ?? ""}
          onChange={(e) => updateTag(wp.id, e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
        >
          {TAG_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt || "(none)"}
            </option>
          ))}
        </select>
      </div>

      {/* Zone */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">Zone</label>
        <select
          value={wp.zoneId ?? ""}
          onChange={(e) => updateZone(wp.id, e.target.value || undefined)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
        >
          <option value="">(none - hallway)</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name} ({z.id})
            </option>
          ))}
        </select>
      </div>

      {/* Connected waypoints */}
      <div>
        <label className="block text-xs text-zinc-400 mb-1">
          Connections ({connectedWaypoints.length})
        </label>
        {connectedWaypoints.length === 0 ? (
          <div className="text-xs text-zinc-500">No connections</div>
        ) : (
          <div className="space-y-1">
            {connectedWaypoints.map(({ edge, otherLabel }) => (
              <div
                key={edge.uid}
                className="flex items-center justify-between bg-zinc-800 rounded px-2 py-1"
              >
                <span className="text-xs text-zinc-300">{otherLabel}</span>
                <button
                  onClick={() => deleteEdge(edge.uid)}
                  className="text-xs text-red-400 hover:text-red-300"
                  title="Remove connection"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete waypoint */}
      <button
        onClick={() => deleteWaypoint(wp.id)}
        className="w-full mt-2 px-2 py-1.5 bg-red-900/50 hover:bg-red-800/50 text-red-300 rounded text-xs"
      >
        Delete Waypoint
      </button>
    </div>
  );
}
