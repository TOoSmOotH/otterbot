import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "../../stores/agent-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { useRoomBuilderStore } from "../../stores/room-builder-store";
import { useMovementStore } from "../../stores/movement-store";
import { AgentCharacter } from "./AgentCharacter";
import { FallbackAgent } from "./FallbackAgent";
import { EnvironmentScene } from "./EnvironmentScene";
import { EditableEnvironmentScene } from "../room-builder/EditableEnvironmentScene";
import type { Agent } from "@otterbot/shared";
import { findWaypointsByZoneAndTag } from "../../lib/pathfinding";

interface LiveViewSceneProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null; gearConfig?: Record<string, boolean> | null; cooName?: string };
}

export function LiveViewScene({ userProfile }: LiveViewSceneProps) {
  const agents = useAgentStore((s) => s.agents);
  // Subscribe to packs so we re-render when they load asynchronously
  const packs = useModelPackStore((s) => s.packs);
  const getPackById = useModelPackStore((s) => s.getPackById);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const builderActive = useRoomBuilderStore((s) => s.active);
  const movementTick = useMovementStore((s) => s.tick);
  const getAgentMovement = useMovementStore((s) => s.getAgentPosition);

  // Tick movement interpolators every frame
  useFrame((_, delta) => {
    movementTick(delta);
  });

  const { positions } = useMemo(() => {
    const activeAgents = Array.from(agents.values()).filter(
      (a) => a.status !== "done",
    );

    // Group by role
    const coos = activeAgents.filter((a) => a.role === "coo");
    const teamLeads = activeAgents.filter((a) => a.role === "team_lead");
    const workers = activeAgents.filter((a) => a.role === "worker");
    const adminAssistants = activeAgents.filter((a) => a.role === "admin_assistant");

    const positions: { agent: Agent | null; role: string; x: number; z: number; label: string; modelPackId: string | null; gearConfig: Record<string, boolean> | null; rotationY: number }[] = [];

    // Zone-aware positioning via waypoint graph
    if (activeScene?.waypointGraph && activeScene?.zones) {
      const graph = activeScene.waypointGraph;
      const mainZone = activeScene.zones.find((z) => z.projectId === null);
      const mainZoneId = mainZone?.id;

      // Helper to get a waypoint position for a role within a zone
      const getZoneWaypointPos = (zoneId: string | undefined, tag: string, index: number): { x: number; z: number; rotationY: number } | null => {
        const wps = findWaypointsByZoneAndTag(graph, zoneId, tag);
        if (wps.length === 0) return null;
        const wp = wps[index % wps.length];
        return { x: wp.position[0], z: wp.position[2], rotationY: 0 };
      };

      // CEO at main office center
      const ceoPos = getZoneWaypointPos(mainZoneId, "center", 0) ?? { x: 0, z: 0, rotationY: 0 };
      positions.push({
        agent: null,
        role: "ceo",
        x: ceoPos.x,
        z: ceoPos.z,
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: ceoPos.rotationY,
      });

      // COOs at main office desk waypoints
      for (let i = 0; i < coos.length; i++) {
        const pos = getZoneWaypointPos(mainZoneId, "desk", i) ?? { x: 0, z: -3, rotationY: 0 };
        positions.push({
          agent: coos[i],
          role: "coo",
          x: pos.x,
          z: pos.z,
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Admin Assistants at main office desk waypoints (offset from COO slots)
      for (let i = 0; i < adminAssistants.length; i++) {
        const pos = getZoneWaypointPos(mainZoneId, "desk", coos.length + i) ?? { x: 3, z: -3, rotationY: 0 };
        positions.push({
          agent: adminAssistants[i],
          role: "admin_assistant",
          x: pos.x,
          z: pos.z,
          label: "Admin Assistant",
          modelPackId: adminAssistants[i].modelPackId ?? null,
          gearConfig: adminAssistants[i].gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Team Leads go to their project zone or main office
      for (let i = 0; i < teamLeads.length; i++) {
        const tl = teamLeads[i];
        const projectZone = tl.projectId
          ? activeScene.zones.find((z) => z.projectId === tl.projectId)
          : null;
        const zoneId = projectZone?.id ?? mainZoneId;
        const pos = getZoneWaypointPos(zoneId, "center", 0) ?? { x: 0, z: -6, rotationY: 0 };
        positions.push({
          agent: tl,
          role: "team_lead",
          x: pos.x,
          z: pos.z,
          label: "Team Lead",
          modelPackId: tl.modelPackId ?? null,
          gearConfig: tl.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Workers go to their project zone
      for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        const projectZone = w.projectId
          ? activeScene.zones.find((z) => z.projectId === w.projectId)
          : null;
        const zoneId = projectZone?.id ?? mainZoneId;
        const pos = getZoneWaypointPos(zoneId, "desk", i) ?? { x: 0, z: -9, rotationY: 0 };
        positions.push({
          agent: w,
          role: "worker",
          x: pos.x,
          z: pos.z,
          label: `Worker ${w.id.slice(0, 6)}`,
          modelPackId: w.modelPackId ?? null,
          gearConfig: w.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }
    } else if (activeScene?.agentPositions) {
      const ap = activeScene.agentPositions;

      // CEO
      positions.push({
        agent: null,
        role: "ceo",
        x: ap.ceo.position[0],
        z: ap.ceo.position[2],
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: ap.ceo.rotation ?? 0,
      });

      // COOs
      for (let i = 0; i < coos.length; i++) {
        const slot = ap.coo[i % ap.coo.length];
        positions.push({
          agent: coos[i],
          role: "coo",
          x: slot.position[0],
          z: slot.position[2],
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Team Leads
      for (let i = 0; i < teamLeads.length; i++) {
        const slot = ap.teamLead[i % ap.teamLead.length];
        positions.push({
          agent: teamLeads[i],
          role: "team_lead",
          x: slot.position[0],
          z: slot.position[2],
          label: "Team Lead",
          modelPackId: teamLeads[i].modelPackId ?? null,
          gearConfig: teamLeads[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Workers
      for (let i = 0; i < workers.length; i++) {
        const slot = ap.worker[i % ap.worker.length];
        positions.push({
          agent: workers[i],
          role: "worker",
          x: slot.position[0],
          z: slot.position[2],
          label: `Worker ${workers[i].id.slice(0, 6)}`,
          modelPackId: workers[i].modelPackId ?? null,
          gearConfig: workers[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }
    } else {
      // Fallback: original grid layout
      positions.push({
        agent: null,
        role: "ceo",
        x: 0,
        z: 0,
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: 0,
      });

      for (let i = 0; i < coos.length; i++) {
        const spread = coos.length > 1 ? (i - (coos.length - 1) / 2) * 3 : 0;
        positions.push({
          agent: coos[i],
          role: "coo",
          x: spread,
          z: -3,
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < teamLeads.length; i++) {
        const spread = (i - (teamLeads.length - 1) / 2) * 3;
        positions.push({
          agent: teamLeads[i],
          role: "team_lead",
          x: spread,
          z: -6,
          label: "Team Lead",
          modelPackId: teamLeads[i].modelPackId ?? null,
          gearConfig: teamLeads[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < workers.length; i++) {
        const spread = (i - (workers.length - 1) / 2) * 3;
        positions.push({
          agent: workers[i],
          role: "worker",
          x: spread,
          z: -9,
          label: `Worker ${workers[i].id.slice(0, 6)}`,
          modelPackId: workers[i].modelPackId ?? null,
          gearConfig: workers[i].gearConfig ?? null,
          rotationY: 0,
        });
      }
    }

    return { positions };
  }, [agents, userProfile, packs, activeScene]);

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
        <EnvironmentScene scene={activeScene} />
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
          const movementState = pos.agent ? getAgentMovement(pos.agent.id) : null;

          if (pack) {
            return (
              <AgentCharacter
                key={pos.agent?.id ?? "ceo"}
                pack={pack}
                position={[pos.x, 0, pos.z]}
                label={pos.label}
                role={pos.role}
                status={status}
                gearConfig={pos.gearConfig}
                rotationY={pos.rotationY}
                movementState={movementState}
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
              rotationY={pos.rotationY}
              movementState={movementState}
            />
          );
        })}

      {/* Camera controls */}
      <OrbitControls
        target={camera?.target ?? [0, 1, -4]}
        minDistance={5}
        maxDistance={activeScene?.zones ? 60 : 25}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
}
