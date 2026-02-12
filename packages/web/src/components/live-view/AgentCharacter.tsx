import { Suspense, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useAnimations, Html, Sparkles } from "@react-three/drei";
import type { ModelPack } from "@smoothbot/shared";
import type { Group } from "three";
import * as THREE from "three";

interface AgentCharacterProps {
  pack: ModelPack;
  position: [number, number, number];
  label: string;
  role: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "#666677",
  thinking: "#3b82f6",
  acting: "#10b981",
  done: "#6b7280",
  error: "#ef4444",
};

export function AgentCharacter({ pack, position, label, role, status }: AgentCharacterProps) {
  return (
    <group position={position}>
      <Suspense fallback={<FallbackMesh role={role} />}>
        <CharacterModel pack={pack} status={status} />
      </Suspense>

      {/* Status ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.6, 0.75, 32]} />
        <meshBasicMaterial
          color={STATUS_COLORS[status] ?? STATUS_COLORS.idle}
          transparent
          opacity={status === "thinking" || status === "acting" ? 0.8 : 0.4}
        />
      </mesh>

      {/* Thinking sparkles */}
      {status === "thinking" && (
        <Sparkles
          count={20}
          scale={1.5}
          size={2}
          speed={0.5}
          position={[0, 1.2, 0]}
          color="#3b82f6"
        />
      )}

      {/* Floating label */}
      <Html position={[0, 2.2, 0]} center distanceFactor={8}>
        <div className="flex flex-col items-center pointer-events-none select-none">
          <span className="text-[10px] font-medium text-white bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5 whitespace-nowrap">
            {label}
          </span>
          {status !== "idle" && status !== "done" && (
            <span
              className="text-[8px] mt-0.5 rounded px-1 py-0.5 whitespace-nowrap"
              style={{
                backgroundColor: STATUS_COLORS[status] ?? STATUS_COLORS.idle,
                color: "white",
              }}
            >
              {status === "thinking" ? "Thinking..." : status === "acting" ? "Acting..." : status === "error" ? "Error" : status}
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}

function CharacterModel({ pack, status }: { pack: ModelPack; status: string }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(pack.characterUrl);
  const clonedScene = useRef(scene.clone(true));

  // Load animations
  const idleGltf = useGLTF(pack.animations.idle);
  const actionGltf = useGLTF(pack.animations.action);

  const allAnimations = [...idleGltf.animations, ...actionGltf.animations];
  const { actions, names } = useAnimations(allAnimations, group);

  // Pick animation based on status
  useEffect(() => {
    if (!actions || names.length === 0) return;

    // Stop all current animations
    Object.values(actions).forEach((a) => a?.fadeOut(0.3));

    // Find appropriate clip
    let clipName: string | undefined;
    if (status === "acting") {
      clipName = names.find((n) => n.toLowerCase().includes("walk") || n.toLowerCase().includes("run") || n.toLowerCase().includes("movement"));
    }
    if (status === "thinking") {
      clipName = names.find((n) => n.toLowerCase().includes("look") || n.toLowerCase().includes("idle"));
    }
    // Default to first available idle
    if (!clipName) {
      clipName = names.find((n) => n.toLowerCase().includes("idle")) ?? names[0];
    }

    if (clipName && actions[clipName]) {
      actions[clipName]!.reset().fadeIn(0.3).play();
    }
  }, [status, actions, names]);

  // Subtle breathing/bob for thinking
  useFrame((_, delta) => {
    if (!group.current) return;
    if (status === "thinking") {
      group.current.position.y = Math.sin(Date.now() * 0.003) * 0.03;
    } else {
      group.current.position.y = THREE.MathUtils.lerp(group.current.position.y, 0, delta * 5);
    }
  });

  return (
    <group ref={group}>
      <primitive object={clonedScene.current} castShadow />
    </group>
  );
}

function FallbackMesh({ role }: { role: string }) {
  const color = role === "coo" ? "#8b5cf6" : role === "team_lead" ? "#f59e0b" : "#06b6d4";
  return (
    <mesh position={[0, 0.75, 0]}>
      <capsuleGeometry args={[0.3, 0.8, 8, 16]} />
      <meshStandardMaterial color={color} transparent opacity={0.5} />
    </mesh>
  );
}
