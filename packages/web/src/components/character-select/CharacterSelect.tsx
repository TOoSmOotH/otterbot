import { Suspense, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, useAnimations, Center } from "@react-three/drei";
import type { ModelPack } from "@smoothbot/shared";
import type { Group } from "three";
import { cn } from "../../lib/utils";

interface CharacterSelectProps {
  packs: ModelPack[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  loading?: boolean;
}

export function CharacterSelect({ packs, selected, onSelect, loading }: CharacterSelectProps) {
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

      {/* Loading placeholder */}
      {loading && packs.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border h-[200px]">
          <svg className="animate-spin h-5 w-5 text-muted-foreground mb-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-muted-foreground">Loading characters...</span>
        </div>
      )}

      {/* Character cards */}
      {packs.map((pack) => (
        <CharacterCard
          key={pack.id}
          pack={pack}
          selected={selected === pack.id}
          onSelect={() => onSelect(pack.id)}
        />
      ))}
    </div>
  );
}

function CharacterCard({ pack, selected, onSelect }: { pack: ModelPack; selected: boolean; onSelect: () => void }) {
  const [canvasError, setCanvasError] = useState(false);

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center rounded-lg border-2 transition-all overflow-hidden h-[200px]",
        selected
          ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
          : "border-border hover:border-muted-foreground bg-background",
      )}
    >
      <div className="flex-1 w-full">
        {canvasError ? (
          <img
            src={pack.thumbnailUrl}
            alt={pack.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <Canvas
            camera={{ position: [0, 1, 3], fov: 40 }}
            style={{ background: "transparent" }}
            onError={() => setCanvasError(true)}
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
        )}
      </div>
      <div className="p-2 text-center w-full border-t border-border/50">
        <span className="text-xs font-medium">{pack.name}</span>
      </div>
    </button>
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
