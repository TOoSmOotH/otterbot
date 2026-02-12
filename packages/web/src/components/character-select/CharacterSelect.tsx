import { Suspense, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, useAnimations, Center } from "@react-three/drei";
import type { ModelPack } from "@smoothbot/shared";
import type { Group } from "three";
import { cn } from "../../lib/utils";

interface CharacterSelectProps {
  packs: ModelPack[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function CharacterSelect({ packs, selected, onSelect }: CharacterSelectProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* None option */}
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border-2 p-4 transition-all h-[200px]",
          selected === null
            ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
            : "border-border hover:border-muted-foreground bg-background",
        )}
      >
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
          <svg className="w-8 h-8 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="8" r="4" />
            <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
          </svg>
        </div>
        <span className="text-sm font-medium">None</span>
        <span className="text-[10px] text-muted-foreground">2D avatar only</span>
      </button>

      {/* Character cards */}
      {packs.map((pack) => (
        <button
          key={pack.id}
          onClick={() => onSelect(pack.id)}
          className={cn(
            "flex flex-col items-center rounded-lg border-2 transition-all overflow-hidden h-[200px]",
            selected === pack.id
              ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
              : "border-border hover:border-muted-foreground bg-background",
          )}
        >
          <div className="flex-1 w-full">
            <Canvas
              camera={{ position: [0, 1, 3], fov: 40 }}
              style={{ background: "transparent" }}
            >
              <ambientLight intensity={0.6} />
              <directionalLight position={[3, 5, 3]} intensity={1} />
              <Suspense fallback={null}>
                <Center>
                  <CharacterPreview url={pack.characterUrl} idleAnimUrl={pack.animations.idle} />
                </Center>
              </Suspense>
              <OrbitControls
                enableZoom={false}
                enablePan={false}
                autoRotate
                autoRotateSpeed={2}
                minPolarAngle={Math.PI / 3}
                maxPolarAngle={Math.PI / 2.2}
              />
            </Canvas>
          </div>
          <div className="p-2 text-center w-full border-t border-border/50">
            <span className="text-xs font-medium">{pack.name}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function CharacterPreview({ url, idleAnimUrl }: { url: string; idleAnimUrl: string }) {
  const group = useRef<Group>(null);
  const { scene } = useGLTF(url);
  const { animations } = useGLTF(idleAnimUrl);
  const { actions } = useAnimations(animations, group);

  // Play the first available animation
  useFrame(() => {
    if (actions) {
      const firstAction = Object.values(actions)[0];
      if (firstAction && !firstAction.isRunning()) {
        firstAction.play();
      }
    }
  });

  return (
    <group ref={group}>
      <primitive object={scene.clone()} />
    </group>
  );
}
