import { Suspense, useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html, Sparkles } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ModelPack, GearConfig } from "@smoothbot/shared";
import * as THREE from "three";
import { applyGearConfig } from "../../lib/gear-utils";

interface AgentCharacterProps {
  pack: ModelPack;
  position: [number, number, number];
  label: string;
  role: string;
  status: string;
  gearConfig?: GearConfig | null;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "#666677",
  thinking: "#3b82f6",
  acting: "#10b981",
  done: "#6b7280",
  error: "#ef4444",
};

export function AgentCharacter({ pack, position, label, role, status, gearConfig }: AgentCharacterProps) {
  return (
    <group position={position}>
      <Suspense fallback={<FallbackMesh role={role} />}>
        <CharacterModel pack={pack} status={status} gearConfig={gearConfig} />
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

function CharacterModel({ pack, status, gearConfig }: { pack: ModelPack; status: string; gearConfig?: GearConfig | null }) {
  const { scene } = useGLTF(pack.characterUrl);
  const { animations: idleAnims } = useGLTF(pack.animations.idle);
  const { animations: actionAnims } = useGLTF(pack.animations.action);

  // Properly clone the scene with skeleton bindings intact
  const clone = useMemo(() => skeletonClone(scene), [scene]);

  // Apply gear visibility after cloning
  useEffect(() => {
    applyGearConfig(clone, gearConfig);
  }, [clone, gearConfig]);

  // Collect all animation clips, filtering out T-Pose
  const clips = useMemo(() => {
    const seen = new Set<string>();
    const result: THREE.AnimationClip[] = [];
    for (const clip of [...idleAnims, ...actionAnims]) {
      if (seen.has(clip.name) || clip.name === "T-Pose") continue;
      seen.add(clip.name);
      result.push(clip);
    }
    return result;
  }, [idleAnims, actionAnims]);

  // Manually manage AnimationMixer on the cloned scene so bone paths resolve correctly
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Map<string, THREE.AnimationAction>>(new Map());
  const currentClipRef = useRef<string | null>(null);

  // Create mixer and actions
  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clone);
    mixerRef.current = mixer;

    const actionMap = new Map<string, THREE.AnimationAction>();
    for (const clip of clips) {
      actionMap.set(clip.name, mixer.clipAction(clip));
    }
    actionsRef.current = actionMap;

    // Play initial animation immediately
    const idleClip =
      actionMap.get("Idle_A") ??
      actionMap.get("Idle_B") ??
      [...actionMap.values()][0];
    if (idleClip) {
      idleClip.play();
      currentClipRef.current = idleClip.getClip().name;
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clone);
    };
  }, [clone, clips]);

  // Switch animation when status changes
  useEffect(() => {
    const actions = actionsRef.current;
    if (actions.size === 0) return;

    let targetName: string | undefined;

    if (status === "acting") {
      targetName =
        findClip(actions, /Walking_A/i) ??
        findClip(actions, /Running_A/i) ??
        findClip(actions, /walk|run/i);
    } else if (status === "thinking") {
      targetName =
        findClip(actions, /Idle_B/i) ??
        findClip(actions, /Interact/i) ??
        findClip(actions, /idle/i);
    } else if (status === "error") {
      targetName =
        findClip(actions, /Hit_A/i) ??
        findClip(actions, /hit/i);
    }

    // Default to Idle_A
    if (!targetName) {
      targetName =
        findClip(actions, /Idle_A/i) ??
        findClip(actions, /idle/i) ??
        [...actions.keys()][0];
    }

    if (!targetName || targetName === currentClipRef.current) return;

    const prev = currentClipRef.current ? actions.get(currentClipRef.current) : null;
    const next = actions.get(targetName);
    if (next) {
      if (prev) prev.fadeOut(0.3);
      next.reset().fadeIn(0.3).play();
      currentClipRef.current = targetName;
    }
  }, [status]);

  // Tick the mixer and add subtle thinking bob
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);

    if (status === "thinking") {
      clone.position.y = Math.sin(Date.now() * 0.003) * 0.03;
    } else {
      clone.position.y = THREE.MathUtils.lerp(clone.position.y, 0, delta * 5);
    }
  });

  return <primitive object={clone} castShadow />;
}

function findClip(actions: Map<string, THREE.AnimationAction>, pattern: RegExp): string | undefined {
  for (const name of actions.keys()) {
    if (pattern.test(name)) return name;
  }
  return undefined;
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
