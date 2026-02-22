import { useRef, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import { TransformControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { useRoomBuilderStore } from "../../stores/room-builder-store";

const TAG_COLORS: Record<string, string> = {
  entrance: "#22c55e",
  desk: "#3b82f6",
  center: "#f59e0b",
  hallway: "#8b5cf6",
  meeting: "#ec4899",
};

const DEFAULT_COLOR = "#666677";

export function WaypointEditor() {
  const waypoints = useRoomBuilderStore((s) => s.editingWaypoints);
  const edges = useRoomBuilderStore((s) => s.editingEdges);
  const selectedId = useRoomBuilderStore((s) => s.selectedWaypointId);
  const connectingFromId = useRoomBuilderStore((s) => s.connectingFromId);
  const waypointTool = useRoomBuilderStore((s) => s.waypointTool);
  const selectWaypoint = useRoomBuilderStore((s) => s.selectWaypoint);
  const addWaypoint = useRoomBuilderStore((s) => s.addWaypoint);
  const deleteWaypoint = useRoomBuilderStore((s) => s.deleteWaypoint);
  const updateWaypointPosition = useRoomBuilderStore((s) => s.updateWaypointPosition);
  const startConnecting = useRoomBuilderStore((s) => s.startConnecting);
  const finishConnecting = useRoomBuilderStore((s) => s.finishConnecting);

  const waypointMap = new Map(waypoints.map((wp) => [wp.id, wp]));

  const handleFloorClick = useCallback((e: THREE.Event) => {
    if (waypointTool !== "add") return;
    const event = e as unknown as { point: THREE.Vector3 };
    const point = event.point;
    addWaypoint([
      Math.round(point.x * 2) / 2,
      0,
      Math.round(point.z * 2) / 2,
    ]);
  }, [waypointTool, addWaypoint]);

  const handleWaypointClick = useCallback((id: string) => {
    if (waypointTool === "delete") {
      deleteWaypoint(id);
    } else if (waypointTool === "connect") {
      if (connectingFromId) {
        finishConnecting(id);
      } else {
        startConnecting(id);
      }
    } else {
      selectWaypoint(id);
    }
  }, [waypointTool, connectingFromId, selectWaypoint, deleteWaypoint, startConnecting, finishConnecting]);

  return (
    <group>
      {/* Click plane for placing waypoints */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.001, 0]}
        visible={false}
        onClick={handleFloorClick}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial />
      </mesh>

      {/* Render edges */}
      {edges.map((edge) => {
        const fromWp = waypointMap.get(edge.from);
        const toWp = waypointMap.get(edge.to);
        if (!fromWp || !toWp) return null;

        return (
          <Line
            key={edge.uid}
            points={[fromWp.position, toWp.position]}
            color="#4488ff"
            lineWidth={2}
            opacity={0.6}
            transparent
          />
        );
      })}

      {/* Render connecting line preview */}
      {connectingFromId && (() => {
        const fromWp = waypointMap.get(connectingFromId);
        if (!fromWp) return null;
        return (
          <Line
            points={[fromWp.position, fromWp.position]}
            color="#ffaa44"
            lineWidth={2}
            dashed
            dashSize={0.3}
            gapSize={0.2}
          />
        );
      })()}

      {/* Render waypoints */}
      {waypoints.map((wp) => {
        const color = wp.tag ? (TAG_COLORS[wp.tag] ?? DEFAULT_COLOR) : DEFAULT_COLOR;
        const isSelected = wp.id === selectedId;
        const isConnectingFrom = wp.id === connectingFromId;

        return (
          <group key={wp.uid} position={wp.position}>
            {/* Waypoint sphere */}
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                handleWaypointClick(wp.id);
              }}
            >
              <sphereGeometry args={[isSelected ? 0.25 : 0.2, 16, 16]} />
              <meshStandardMaterial
                color={isConnectingFrom ? "#ffaa44" : color}
                emissive={isSelected ? color : "#000000"}
                emissiveIntensity={isSelected ? 0.5 : 0}
              />
            </mesh>

            {/* Vertical line to show height */}
            <Line
              points={[[0, -wp.position[1], 0], [0, 0.5, 0]]}
              color={color}
              lineWidth={1}
              opacity={0.3}
              transparent
            />

            {/* Label */}
            {wp.label && (
              <sprite position={[0, 0.6, 0]} scale={[1.5, 0.4, 1]}>
                <spriteMaterial color="white" opacity={0.8} transparent />
              </sprite>
            )}
          </group>
        );
      })}

      {/* TransformControls for selected waypoint */}
      {selectedId && waypointTool === "select" && (
        <WaypointTransformControls
          waypointId={selectedId}
          position={waypointMap.get(selectedId)?.position ?? [0, 0, 0]}
          onUpdate={updateWaypointPosition}
        />
      )}
    </group>
  );
}

function WaypointTransformControls({
  waypointId,
  position,
  onUpdate,
}: {
  waypointId: string;
  position: [number, number, number];
  onUpdate: (id: string, pos: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { gl } = useThree();

  return (
    <group>
      <group ref={groupRef} position={position}>
        <mesh visible={false}>
          <boxGeometry args={[0.01, 0.01, 0.01]} />
          <meshBasicMaterial />
        </mesh>
      </group>
      {groupRef.current && (
        <TransformControls
          object={groupRef.current}
          mode="translate"
          onObjectChange={() => {
            if (!groupRef.current) return;
            const pos = groupRef.current.position;
            onUpdate(waypointId, [
              Math.round(pos.x * 2) / 2,
              Math.round(pos.y * 2) / 2,
              Math.round(pos.z * 2) / 2,
            ]);
          }}
          domElement={gl.domElement}
        />
      )}
    </group>
  );
}
