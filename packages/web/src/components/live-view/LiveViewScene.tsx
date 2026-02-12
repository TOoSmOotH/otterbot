import { useMemo } from "react";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "../../stores/agent-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import { useEnvironmentStore } from "../../stores/environment-store";
import { AgentCharacter } from "./AgentCharacter";
import { FallbackAgent } from "./FallbackAgent";
import { EnvironmentScene } from "./EnvironmentScene";
import type { Agent } from "@smoothbot/shared";

interface LiveViewSceneProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null; gearConfig?: Record<string, boolean> | null };
}

export function LiveViewScene({ userProfile }: LiveViewSceneProps) {
  const agents = useAgentStore((s) => s.agents);
  // Subscribe to packs so we re-render when they load asynchronously
  const packs = useModelPackStore((s) => s.packs);
  const getPackById = useModelPackStore((s) => s.getPackById);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());

  const { positions } = useMemo(() => {
    const activeAgents = Array.from(agents.values()).filter(
      (a) => a.status !== "done",
    );

    // Group by role
    const coos = activeAgents.filter((a) => a.role === "coo");
    const teamLeads = activeAgents.filter((a) => a.role === "team_lead");
    const workers = activeAgents.filter((a) => a.role === "worker");

    const positions: { agent: Agent | null; role: string; x: number; z: number; label: string; modelPackId: string | null; gearConfig: Record<string, boolean> | null; rotationY: number }[] = [];

    if (activeScene?.agentPositions) {
      const ap = activeScene.agentPositions;

      // CEO
      positions.push({
        agent: null,
        role: "ceo",
        x: ap.ceo.position[0],
        z: ap.ceo.position[2],
        label: userProfile?.name ? `${userProfile.name} (CEO)` : "CEO (You)",
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
          label: "COO",
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
        label: userProfile?.name ? `${userProfile.name} (CEO)` : "CEO (You)",
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
          label: "COO",
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

      {/* Environment or fallback ground */}
      {activeScene ? (
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

      {/* Characters */}
      {positions.map((pos) => {
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
            rotationY={pos.rotationY}
          />
        );
      })}

      {/* Camera controls */}
      <OrbitControls
        target={camera?.target ?? [0, 1, -4]}
        minDistance={5}
        maxDistance={25}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
}
