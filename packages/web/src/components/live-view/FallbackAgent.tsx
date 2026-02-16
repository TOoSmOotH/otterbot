import { useRef, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import type { Mesh } from "three";
import * as THREE from "three";
import { useMovementStore } from "../../stores/movement-store";

interface FallbackAgentProps {
  position: [number, number, number];
  label: string;
  role: string;
  status: string;
  agentId?: string;
  rotationY?: number;
}

const ROLE_COLORS: Record<string, string> = {
  ceo: "#a855f7",     // purple
  coo: "#8b5cf6",     // violet
  team_lead: "#f59e0b", // amber
  worker: "#06b6d4",   // cyan
  admin_assistant: "#e879f9", // pink
};

const STATUS_COLORS: Record<string, string> = {
  idle: "#666677",
  thinking: "#3b82f6",
  acting: "#10b981",
  done: "#6b7280",
  error: "#ef4444",
};

export function FallbackAgent({ position, label, role, status, agentId, rotationY = 0 }: FallbackAgentProps) {
  const meshRef = useRef<Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const currentRotationRef = useRef(rotationY);
  const targetPosRef = useRef(new THREE.Vector3(...position));
  const [isMoving, setIsMoving] = useState(false);
  const color = ROLE_COLORS[role] ?? ROLE_COLORS.worker;

  // Update target position when prop changes
  useEffect(() => {
    targetPosRef.current.set(...position);
  }, [position[0], position[1], position[2]]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const ms = agentId ? useMovementStore.getState().getAgentPosition(agentId) : null;
    const moving = ms?.isMoving ?? false;

    if (moving !== isMoving) setIsMoving(moving);

    // Update group position/rotation for movement
    if (groupRef.current) {
      if (moving && ms) {
        groupRef.current.position.set(...ms.position);
        currentRotationRef.current = THREE.MathUtils.lerp(currentRotationRef.current, ms.rotationY, delta * 8);
      } else {
        groupRef.current.position.lerp(targetPosRef.current, delta * 5);
        currentRotationRef.current = THREE.MathUtils.lerp(currentRotationRef.current, rotationY, delta * 5);
      }
      groupRef.current.rotation.y = currentRotationRef.current;
    }

    // Gentle hover animation
    const baseY = 0.75;
    if (moving) {
      // Bobbing while walking
      meshRef.current.position.y = baseY + Math.sin(Date.now() * 0.008) * 0.05;
    } else if (status === "thinking") {
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
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
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
