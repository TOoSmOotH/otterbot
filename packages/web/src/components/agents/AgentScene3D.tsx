import { Suspense, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AgentProfileSummary } from "@otterbot/shared";
import { useAgentsStore } from "../../stores/agents-store";
import { useModelPacksStore } from "../../stores/model-packs-store";
import { statusColor } from "./agent-visual";

/**
 * 3D office view: every agent rendered as its worker character on a shared
 * floor, arranged in a ring, with a status-coloured ring under each. Reuses
 * the original otterbot character GLBs as agent avatars.
 */
export function AgentScene3D() {
  const agents = useAgentsStore((s) => s.agents);
  const packs = useModelPacksStore((s) => s.packs);
  const loadPacks = useModelPacksStore((s) => s.load);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const radius = Math.max(3.5, agents.length * 0.95);

  return (
    <div style={{ height: "100%", width: "100%" }} data-testid="agent-scene-3d">
      <Canvas camera={{ position: [0, 9, 13], fov: 50 }} style={{ background: "#0a0a0f" }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[10, 16, 10]} intensity={1.1} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[44, 44]} />
          <meshStandardMaterial color="#1a1a22" />
        </mesh>
        <Suspense fallback={null}>
          {agents.map((a, i) => {
            const angle = (i / Math.max(1, agents.length)) * Math.PI * 2;
            const pos: [number, number, number] = [
              Math.cos(angle) * radius,
              0,
              Math.sin(angle) * radius,
            ];
            const pack = packs.find((p) => p.id === a.artwork.modelPack);
            return (
              <AgentFigure
                key={a.id}
                pos={pos}
                characterUrl={pack?.characterUrl ?? null}
                agent={a}
              />
            );
          })}
        </Suspense>
        <OrbitControls target={[0, 1, 0]} />
      </Canvas>
    </div>
  );
}

function AgentFigure({
  pos,
  characterUrl,
  agent,
}: {
  pos: [number, number, number];
  characterUrl: string | null;
  agent: AgentProfileSummary;
}) {
  const ring = statusColor(agent.status);
  return (
    <group position={pos}>
      {/* status ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.9, 0.07, 8, 40]} />
        <meshStandardMaterial color={ring} emissive={ring} emissiveIntensity={0.5} />
      </mesh>
      <Character url={characterUrl} accent={agent.role === "coo"} />
      <Text position={[0, 2.5, 0]} fontSize={0.34} color="white" anchorX="center">
        {agent.displayName}
      </Text>
    </group>
  );
}

function Character({ url, accent }: { url: string | null; accent: boolean }) {
  if (url) {
    try {
      const gltf = useLoader(GLTFLoader, url);
      return <primitive object={gltf.scene.clone()} scale={1} castShadow />;
    } catch {
      // fall through to the capsule placeholder
    }
  }
  return (
    <mesh position={[0, 0.85, 0]} castShadow>
      <capsuleGeometry args={[0.38, 1, 4, 8]} />
      <meshStandardMaterial color={accent ? "#6b8cff" : "#4ade80"} />
    </mesh>
  );
}
