import { Suspense, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { useSceneStore } from "../../stores/scene-store";
import type { SceneConfig, SceneProp } from "@otterbot/shared";

/**
 * Minimal 3D visualization: renders the active scene's props + a simple
 * agent avatar at origin. We deliberately keep this smaller than the old
 * LiveView — no agent motion, no room-builder, no chat bubbles. Meant to
 * grow in a later phase.
 */
export function View3D() {
  const load = useSceneStore((s) => s.load);
  const scene = useSceneStore((s) => s.activeScene());

  useEffect(() => {
    void load();
  }, [load]);

  if (!scene) {
    return (
      <div style={{ padding: 16, color: "rgb(var(--muted))" }} data-testid="view-3d-empty">
        Loading scene…
      </div>
    );
  }

  const camPos = scene.camera?.position ?? [0, 12, 12];
  const camTarget = scene.camera?.target ?? [0, 0, 0];

  return (
    <div style={{ height: "100%", width: "100%" }} data-testid="view-3d">
      <Canvas
        camera={{ position: camPos, fov: 50 }}
        shadows
        style={{ background: "#0a0a0f" }}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={scene.lighting?.ambientIntensity ?? 0.6} />
        <directionalLight
          position={scene.lighting?.directionalPosition ?? [10, 15, 10]}
          intensity={scene.lighting?.directionalIntensity ?? 1.2}
          castShadow
        />
        <Floor scene={scene} />
        <Suspense fallback={null}>
          <Props props={scene.props} />
        </Suspense>
        <AgentAvatar />
        <OrbitControls target={camTarget} />
      </Canvas>
    </div>
  );
}

function Floor({ scene }: { scene: SceneConfig }) {
  const color = scene.floor?.color ?? "#1a1a22";
  const size = scene.floor?.size ?? [40, 40];
  const pos = scene.floor?.position ?? [0, -0.5, 0];
  return (
    <mesh position={pos} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={size} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function Props({ props: propList }: { props: SceneProp[] }) {
  return (
    <>
      {propList.map((p, i) => (
        <PropMesh key={i} prop={p} />
      ))}
    </>
  );
}

function PropMesh({ prop }: { prop: SceneProp }) {
  // Try to load the GLB; if it fails, render a placeholder box.
  const assetUrl = `/assets/3d/environments/${prop.asset.split("/")[0]}/models/${prop.asset.split("/")[1]}.gltf`;
  const scale = typeof prop.scale === "number" ? [prop.scale, prop.scale, prop.scale] : (prop.scale ?? [1, 1, 1]);
  try {
    const gltf = useLoader(GLTFLoader, assetUrl);
    return (
      <primitive
        object={gltf.scene.clone()}
        position={prop.position}
        rotation={prop.rotation ?? [0, 0, 0]}
        scale={scale}
        castShadow={prop.castShadow}
        receiveShadow={prop.receiveShadow}
      />
    );
  } catch {
    return (
      <mesh position={prop.position} rotation={prop.rotation ?? [0, 0, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#444" />
      </mesh>
    );
  }
}

function AgentAvatar() {
  return (
    <mesh position={[0, 0.75, 0]} castShadow>
      <capsuleGeometry args={[0.4, 1, 4, 8]} />
      <meshStandardMaterial color="#4ade80" />
    </mesh>
  );
}
