import { useMemo } from "react";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "../../stores/agent-store";
import { useModelPackStore } from "../../stores/model-pack-store";
import { AgentCharacter } from "./AgentCharacter";
import { FallbackAgent } from "./FallbackAgent";
import type { Agent } from "@smoothbot/shared";

interface LiveViewSceneProps {
  userProfile?: { name: string | null; avatar: string | null; modelPackId?: string | null };
}

export function LiveViewScene({ userProfile }: LiveViewSceneProps) {
  const agents = useAgentStore((s) => s.agents);
  // Subscribe to packs so we re-render when they load asynchronously
  const packs = useModelPackStore((s) => s.packs);
  const getPackById = useModelPackStore((s) => s.getPackById);

  const { positions } = useMemo(() => {
    const activeAgents = Array.from(agents.values()).filter(
      (a) => a.status !== "done",
    );

    // Group by role
    const coos = activeAgents.filter((a) => a.role === "coo");
    const teamLeads = activeAgents.filter((a) => a.role === "team_lead");
    const workers = activeAgents.filter((a) => a.role === "worker");

    const positions: { agent: Agent | null; role: string; x: number; z: number; label: string; modelPackId: string | null }[] = [];

    // CEO at center
    positions.push({
      agent: null,
      role: "ceo",
      x: 0,
      z: 0,
      label: userProfile?.name ? `${userProfile.name} (CEO)` : "CEO (You)",
      modelPackId: userProfile?.modelPackId ?? null,
    });

    // COO behind
    for (let i = 0; i < coos.length; i++) {
      const spread = coos.length > 1 ? (i - (coos.length - 1) / 2) * 3 : 0;
      positions.push({
        agent: coos[i],
        role: "coo",
        x: spread,
        z: -3,
        label: "COO",
        modelPackId: coos[i].modelPackId ?? null,
      });
    }

    // Team Leads at z = -6
    for (let i = 0; i < teamLeads.length; i++) {
      const spread = (i - (teamLeads.length - 1) / 2) * 3;
      positions.push({
        agent: teamLeads[i],
        role: "team_lead",
        x: spread,
        z: -6,
        label: `Team Lead`,
        modelPackId: teamLeads[i].modelPackId ?? null,
      });
    }

    // Workers at z = -9
    for (let i = 0; i < workers.length; i++) {
      const spread = (i - (workers.length - 1) / 2) * 3;
      positions.push({
        agent: workers[i],
        role: "worker",
        x: spread,
        z: -9,
        label: `Worker ${workers[i].id.slice(0, 6)}`,
        modelPackId: workers[i].modelPackId ?? null,
      });
    }

    return { positions };
  }, [agents, userProfile, packs]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[5, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <pointLight position={[-5, 5, -5]} intensity={0.3} color="#4488ff" />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -4]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#111118" transparent opacity={0.8} />
      </mesh>

      {/* Grid helper */}
      <gridHelper args={[40, 40, "#222233", "#181825"]} position={[0, 0, -4]} />

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
          />
        );
      })}

      {/* Camera controls */}
      <OrbitControls
        target={[0, 1, -4]}
        minDistance={5}
        maxDistance={25}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  );
}
