import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "../../stores/agent-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { useMovementStore } from "../../stores/movement-store";
import { useExplosionStore } from "../../stores/explosion-store";
import { AgentCharacter } from "./AgentCharacter";
import { FallbackAgent } from "./FallbackAgent";
import { AgentExplosion } from "./AgentExplosion";
import { EnvironmentScene } from "./EnvironmentScene";
import { ZoneGroundMarkers } from "./ZoneGroundMarkers";
import { WASDControls } from "./WASDControls";
import { EditableEnvironmentScene } from "../room-builder/EditableEnvironmentScene";
import { useAgentPositions } from "../../hooks/use-agent-positions";

const ROLE_COLORS: Record<string, string> = {
  ceo: "#a855f7",
  coo: "#8b5cf6",
  team_lead: "#f59e0b",
  worker: "#06b6d4",
  admin_assistant: "#e879f9",
  scheduler: "#f97316",
};

interface LiveViewSceneProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null; gearConfig?: Record<string, boolean> | null; cooName?: string };
}

export function LiveViewScene({ userProfile }: LiveViewSceneProps) {
  const departingIds = useAgentStore((s) => s._departingIds);
  const getPackById = useModelPackStore((s) => s.getPackById);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const builderActive = useRoomBuilderStore((s) => s.active);
  const movementTick = useMovementStore((s) => s.tick);
  const explosions = useExplosionStore((s) => s.explosions);

  // Track departing agents: value = frame count since departure started.
  // We skip the first few frames to give the movement system time to enqueue the walk.
  const departureFramesRef = useRef(new Map<string, number>());

  // Tick movement interpolators every frame + check departing agents
  useFrame((_, delta) => {
    movementTick(delta);

    // Check if any departing agents have finished walking to center
    const { _departingIds, agents: currentAgents, removeAgent } = useAgentStore.getState();
    const movementState = useMovementStore.getState();
    const frames = departureFramesRef.current;

    // Track new departures
    for (const id of _departingIds) {
      if (!frames.has(id)) frames.set(id, 0);
    }

    // Clean up stale tracking
    for (const id of frames.keys()) {
      if (!_departingIds.has(id)) frames.delete(id);
    }

    for (const id of _departingIds) {
      const frameCount = frames.get(id) ?? 0;
      frames.set(id, frameCount + 1);

      // Wait at least 10 frames for the movement system to start the walk
      if (frameCount < 10) continue;

      if (!movementState.isAgentBusy(id)) {
        frames.delete(id);
        const agent = currentAgents.get(id);
        const lastPos = movementState.getLastKnownPosition(id);
        const position: [number, number, number] = lastPos ?? [0, 0, 0];
        const color = agent ? (ROLE_COLORS[agent.role] ?? ROLE_COLORS.worker) : "#06b6d4";
        useExplosionStore.getState().addExplosion(id, position, color);
        removeAgent(id);
      }
    }
  });

  const positions = useAgentPositions(userProfile);

  const lighting = activeScene?.lighting;
  const camera = activeScene?.camera;

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={lighting?.ambientIntensity ?? 0.4} />
      <directionalLight
        position={lighting?.directionalPosition ?? [5, 10, 5]}
        intensity={lighting?.directionalIntensity ?? 1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={5}
        shadow-camera-bottom={-15}
      />
      {!activeScene && (
        <pointLight position={[-5, 5, -5]} intensity={0.3} color="#4488ff" />
      )}

      {/* Environment: editable in builder mode, read-only otherwise */}
      {builderActive ? (
        <EditableEnvironmentScene />
      ) : activeScene ? (
        <>
          <EnvironmentScene scene={activeScene} />
          {activeScene.zones && <ZoneGroundMarkers zones={activeScene.zones} />}
        </>
      ) : (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -4]} receiveShadow>
            <planeGeometry args={[40, 40]} />
            <meshStandardMaterial color="#111118" transparent opacity={0.8} />
          </mesh>
          <gridHelper args={[40, 40, "#222233", "#181825"]} position={[0, 0, -4]} />
        </>
      )}

      {/* Characters — hidden during room editing */}
      {!builderActive &&
        positions.map((pos) => {
          const pack = pos.modelPackId ? getPackById(pos.modelPackId) : undefined;
          const status = pos.agent?.status ?? "idle";

          if (pack) {
            return (
              <AgentCharacter
                key={pos.agent?.id ?? "ceo"}
                pack={pack}
                position={[pos.x, 0, pos.z]}
                label={pos.label}
                role={pos.role}
                status={status}
                agentId={pos.agent?.id}
                gearConfig={pos.gearConfig}
                rotationY={pos.rotationY}
              />
            );
          }

          return (
            <FallbackAgent
              key={pos.agent?.id ?? "ceo"}
              position={[pos.x, 0, pos.z]}
              label={pos.label}
              role={pos.role}
              status={status}
              agentId={pos.agent?.id}
              rotationY={pos.rotationY}
            />
          );
        })}

      {/* Explosions */}
      {Array.from(explosions.values()).map((exp) => (
        <AgentExplosion
          key={exp.id}
          id={exp.id}
          position={exp.position}
          color={exp.color}
        />
      ))}

      {/* Camera controls */}
      <OrbitControls
        makeDefault
        target={camera?.target ?? [0, 1, -4]}
        minDistance={5}
        maxDistance={activeScene?.zones ? 60 : 25}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.1}
        enableKeys={false}
      />
      <WASDControls disabled={builderActive} />
    </>
  );
}
