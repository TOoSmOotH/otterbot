import { Suspense, useMemo, useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html, Sparkles } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ModelPack, GearConfig } from "@otterbot/shared";
import * as THREE from "three";
import { applyGearConfig } from "../../lib/gear-utils";
import { useMovementStore } from "../../stores/movement-store";

interface AgentCharacterProps {
  pack: ModelPack;
  position: [number, number, number];
  label: string;
  role: string;
  status: string;
  agentId?: string;
  gearConfig?: GearConfig | null;
  rotationY?: number;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "#666677",
  thinking: "#3b82f6",
  acting: "#10b981",
  done: "#6b7280",
  error: "#ef4444",
};

export function AgentCharacter({ pack, position, label, role, status, agentId, gearConfig, rotationY = 0 }: AgentCharacterProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentRotationRef = useRef(rotationY);
  const targetPosRef = useRef(new THREE.Vector3(...position));
  const tempVec3 = useRef(new THREE.Vector3());

  // Set initial position once on mount so the group starts at the right spot
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.set(...position);
      groupRef.current.rotation.y = rotationY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update target position when prop changes
  useEffect(() => {
    targetPosRef.current.set(...position);
  }, [position[0], position[1], position[2]]);

  // Read movement state directly from store each frame
  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const store = useMovementStore.getState();
    const ms = agentId ? store.getAgentPosition(agentId) : null;
    const moving = ms?.isMoving ?? false;
    const busy = agentId ? store.isAgentBusy(agentId) : false;

    if (moving && ms) {
      groupRef.current.position.set(...ms.position);
      currentRotationRef.current = THREE.MathUtils.lerp(currentRotationRef.current, ms.rotationY, delta * 8);
    } else if (busy) {
      // Hold current position — queue is about to start the next walk
    } else {
      // If the movement system placed this agent somewhere, stay there
      // instead of sliding back to the prop position (prevents roaming snap-back).
      const lastPos = agentId ? store.getLastKnownPosition(agentId) : null;
      if (lastPos) {
        groupRef.current.position.lerp(tempVec3.current.set(...lastPos), delta * 5);
      } else {
        // No movement history — smoothly interpolate to computed home position
        groupRef.current.position.lerp(targetPosRef.current, delta * 5);
      }
      currentRotationRef.current = THREE.MathUtils.lerp(currentRotationRef.current, rotationY, delta * 5);
    }

    groupRef.current.rotation.y = currentRotationRef.current;
  });

  return (
    <group ref={groupRef}>
      <Suspense fallback={<FallbackMesh role={role} />}>
        <CharacterModel pack={pack} status={status} agentId={agentId} gearConfig={gearConfig} />
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

function CharacterModel({ pack, status, agentId, gearConfig }: { pack: ModelPack; status: string; agentId?: string; gearConfig?: GearConfig | null }) {
  const { scene } = useGLTF(pack.characterUrl);
  const { animations: idleAnims } = useGLTF(pack.animations.idle);
  const { animations: actionAnims } = useGLTF(pack.animations.action);
  const { animations: workingAnims } = useGLTF(pack.animations.working ?? pack.animations.idle);

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
    for (const clip of [...idleAnims, ...actionAnims, ...workingAnims]) {
      if (seen.has(clip.name) || clip.name === "T-Pose") continue;
      seen.add(clip.name);
      result.push(clip);
    }
    return result;
  }, [idleAnims, actionAnims, workingAnims]);

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

  // Track the last effective status so we only switch animations on change
  const prevEffectiveStatusRef = useRef<string>(status);

  // Tick the mixer, detect walking from movement store, and switch animations — all in the animation loop
  useFrame((_, delta) => {
    mixerRef.current?.update(delta);

    // Determine effective status: walking overrides when movement store is active
    const ms = agentId ? useMovementStore.getState().getAgentPosition(agentId) : null;
    const effectiveStatus = ms?.isMoving ? "walking" : status;

    // Switch animation when effective status changes
    if (effectiveStatus !== prevEffectiveStatusRef.current) {
      prevEffectiveStatusRef.current = effectiveStatus;

      const actions = actionsRef.current;
      if (actions.size > 0) {
        let targetName: string | undefined;

        if (effectiveStatus === "walking") {
          targetName =
            findClip(actions, /Walking_A/i) ??
            findClip(actions, /Running_A/i) ??
            findClip(actions, /walk|run/i);
        } else if (effectiveStatus === "acting") {
          const candidates = findAllClips(actions, /Working/i, /GenericWorking/i, /Interact/i, /Use_Item/i, /PickUp/i);
          targetName = pickRandom(candidates) ??
            findClip(actions, /Idle_B/i) ??
            findClip(actions, /idle/i);
        } else if (effectiveStatus === "thinking") {
          const candidates = findAllClips(actions, /Idle_B/i, /Interact/i);
          targetName = pickRandom(candidates) ??
            findClip(actions, /idle/i);
        } else if (effectiveStatus === "error") {
          targetName =
            findClip(actions, /Hit_A/i) ??
            findClip(actions, /hit/i);
        }

        if (!targetName) {
          targetName =
            findClip(actions, /Idle_A/i) ??
            findClip(actions, /idle/i) ??
            [...actions.keys()][0];
        }

        if (targetName && targetName !== currentClipRef.current) {
          const prev = currentClipRef.current ? actions.get(currentClipRef.current) : null;
          const next = actions.get(targetName);
          if (next) {
            if (prev) prev.fadeOut(0.3);
            next.reset().fadeIn(0.3).play();
            currentClipRef.current = targetName;
          }
        }
      }
    }

    // Thinking bob
    if (effectiveStatus === "thinking") {
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

function findAllClips(actions: Map<string, THREE.AnimationAction>, ...patterns: RegExp[]): string[] {
  const results: string[] = [];
  for (const name of actions.keys()) {
    if (patterns.some((p) => p.test(name))) results.push(name);
  }
  return results;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

function FallbackMesh({ role }: { role: string }) {
  const color = role === "coo" ? "#8b5cf6" : role === "team_lead" ? "#f59e0b" : role === "admin_assistant" ? "#e879f9" : role === "scheduler" ? "#f97316" : "#06b6d4";
  return (
    <mesh position={[0, 0.75, 0]}>
      <capsuleGeometry args={[0.3, 0.8, 8, 16]} />
      <meshStandardMaterial color={color} transparent opacity={0.5} />
    </mesh>
  );
}
