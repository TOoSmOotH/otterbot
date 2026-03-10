import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useExplosionStore } from "../../stores/explosion-store";

const PARTICLE_COUNT = 36;
const DURATION = 1.2; // seconds

interface AgentExplosionProps {
  id: string;
  position: [number, number, number];
  color: string;
}

export function AgentExplosion({ id, position, color }: AgentExplosionProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startTime = useRef(Date.now());
  const removed = useRef(false);

  // Pre-compute random velocities for each particle (spherical distribution + upward bias)
  const velocities = useMemo(() => {
    const vels: THREE.Vector3[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 1.5 + Math.random() * 2.5;
      vels.push(
        new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.abs(Math.cos(phi)) * speed + 1.0, // upward bias
          Math.sin(phi) * Math.sin(theta) * speed,
        ),
      );
    }
    return vels;
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  // Set initial color on all instances
  useMemo(() => {
    // Will be applied in useFrame on first tick
  }, []);

  useFrame(() => {
    if (!meshRef.current || removed.current) return;

    const elapsed = (Date.now() - startTime.current) / 1000;
    const progress = elapsed / DURATION;

    if (progress >= 1) {
      if (!removed.current) {
        removed.current = true;
        useExplosionStore.getState().removeExplosion(id);
      }
      return;
    }

    const gravity = -9.8;
    const opacity = 1 - progress * progress; // quadratic fade

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const vel = velocities[i];
      const x = position[0] + vel.x * elapsed;
      const y = position[1] + 0.75 + vel.y * elapsed + 0.5 * gravity * elapsed * elapsed;
      const z = position[2] + vel.z * elapsed;

      // Shrink particles as they fade
      const scale = (1 - progress) * (0.5 + Math.random() * 0.1);

      dummy.position.set(x, Math.max(y, 0.05), z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      // Fade color towards dark
      const c = baseColor.clone().lerp(new THREE.Color("#000000"), progress * 0.5);
      meshRef.current.setColorAt(i, c);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }

    // Update material opacity
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.opacity = opacity;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <sphereGeometry args={[0.06, 6, 6]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.6}
        transparent
        depthWrite={false}
      />
    </instancedMesh>
  );
}
