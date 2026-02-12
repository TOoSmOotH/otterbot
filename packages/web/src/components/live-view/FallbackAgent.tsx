import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import type { Mesh } from "three";
import * as THREE from "three";

interface FallbackAgentProps {
  position: [number, number, number];
  label: string;
  role: string;
  status: string;
}

const ROLE_COLORS: Record<string, string> = {
  ceo: "#a855f7",     // purple
  coo: "#8b5cf6",     // violet
  team_lead: "#f59e0b", // amber
  worker: "#06b6d4",   // cyan
};

const STATUS_COLORS: Record<string, string> = {
  idle: "#666677",
  thinking: "#3b82f6",
  acting: "#10b981",
  done: "#6b7280",
  error: "#ef4444",
};

export function FallbackAgent({ position, label, role, status }: FallbackAgentProps) {
  const meshRef = useRef<Mesh>(null);
  const color = ROLE_COLORS[role] ?? ROLE_COLORS.worker;

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Gentle hover animation
    const baseY = 0.75;
    if (status === "thinking") {
      meshRef.current.position.y = baseY + Math.sin(Date.now() * 0.003) * 0.08;
      meshRef.current.rotation.y += delta * 0.5;
    } else if (status === "acting") {
      meshRef.current.position.y = baseY + Math.sin(Date.now() * 0.005) * 0.04;
      meshRef.current.rotation.y += delta * 1.5;
    } else {
      meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, baseY, delta * 3);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, 0, delta * 2);
    }
  });

  return (
    <group position={position}>
      {/* Capsule body */}
      <mesh ref={meshRef} position={[0, 0.75, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.8, 8, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={status === "thinking" ? "#3b82f6" : status === "acting" ? "#10b981" : "#000000"}
          emissiveIntensity={status === "thinking" || status === "acting" ? 0.3 : 0}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>

      {/* Status ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.5, 0.65, 32]} />
        <meshBasicMaterial
          color={STATUS_COLORS[status] ?? STATUS_COLORS.idle}
          transparent
          opacity={status === "thinking" || status === "acting" ? 0.8 : 0.3}
        />
      </mesh>

      {/* Thinking sparkles */}
      {status === "thinking" && (
        <Sparkles
          count={15}
          scale={1.2}
          size={2}
          speed={0.4}
          position={[0, 1, 0]}
          color="#3b82f6"
        />
      )}

      {/* Floating label */}
      <Html position={[0, 1.8, 0]} center distanceFactor={8}>
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
