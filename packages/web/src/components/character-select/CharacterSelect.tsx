import { Suspense, useMemo, useRef, useState, useEffect, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, useGLTF, Center } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelPack, GearConfig } from "@otterbot/shared";
import * as THREE from "three";
import { cn } from "../../lib/utils";
import { discoverGearMeshes, applyGearConfig, formatGearName } from "../../lib/gear-utils";

interface CharacterSelectProps {
  packs: ModelPack[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  loading?: boolean;
  gearConfig?: GearConfig | null;
  onGearConfigChange?: (config: GearConfig | null) => void;
}

export function CharacterSelect({ packs, selected, onSelect, loading, gearConfig, onGearConfigChange }: CharacterSelectProps) {
  const selectedPack = packs.find((p) => p.id === selected);
  const [discoveredGear, setDiscoveredGear] = useState<string[]>([]);

  // Discover gear meshes outside the Canvas using GLTFLoader directly.
  // This avoids the R3F/DOM reconciler boundary issue where state updates
  // from inside <Canvas> don't reliably trigger re-renders in the outer tree.
  useEffect(() => {
    if (!selectedPack) {
      setDiscoveredGear([]);
      return;
    }

    const loader = new GLTFLoader();
    loader.load(selectedPack.characterUrl, (gltf) => {
      const gear = discoverGearMeshes(gltf.scene);
      setDiscoveredGear(gear);
    });
  }, [selectedPack?.characterUrl]);

  // Reset gear when switching packs
  const handleSelect = useCallback((id: string | null) => {
    onSelect(id);
    setDiscoveredGear([]);
    onGearConfigChange?.(null);
  }, [onSelect, onGearConfigChange]);

  const toggleGear = useCallback((meshName: string) => {
    const current = gearConfig ?? {};
    const isVisible = current[meshName] !== false;
    const next = { ...current, [meshName]: !isVisible };

    // If all entries are true (visible), compact to null
    const hasHidden = Object.values(next).some((v) => v === false);
    onGearConfigChange?.(hasHidden ? next : null);
  }, [gearConfig, onGearConfigChange]);

  return (
    <div className="space-y-3">
      {/* Large preview of selected character */}
      {selectedPack && (
        <div className="rounded-lg border border-border overflow-hidden bg-background h-[240px]">
          <Canvas
            camera={{ position: [0, 1, 3], fov: 40 }}
            style={{ background: "linear-gradient(180deg, #111118 0%, #1a1a2e 100%)" }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[3, 5, 3]} intensity={1} />
            <Suspense fallback={null}>
              <Center>
                <CharacterPreview
                  url={selectedPack.characterUrl}
                  idleAnimUrl={selectedPack.animations.idle}
                  gearConfig={gearConfig}
                />
              </Center>
            </Suspense>
            <OrbitControls
              enableZoom
              enablePan
              autoRotate
              autoRotateSpeed={1}
              minDistance={1.5}
              maxDistance={6}
              minPolarAngle={0.3}
              maxPolarAngle={Math.PI / 2}
            />
          </Canvas>
        </div>
      )}

      {/* Gear toggles */}
      {selectedPack && discoveredGear.length > 0 && onGearConfigChange && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Gear
          </p>
          <div className="flex flex-wrap gap-1.5">
            {discoveredGear.map((name) => {
              const visible = (gearConfig ?? {})[name] !== false;
              return (
                <button
                  key={name}
                  onClick={() => toggleGear(name)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-md border transition-colors",
                    visible
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground line-through opacity-60 hover:opacity-80",
                  )}
                >
                  {formatGearName(name)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selection grid */}
      <div className="grid grid-cols-3 gap-2">
        {/* None option */}
        <button
          onClick={() => handleSelect(null)}
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 p-3 transition-all h-[80px]",
            selected === null
              ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
              : "border-border hover:border-muted-foreground bg-background",
          )}
        >
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center mb-1">
            <svg className="w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4" />
              <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
            </svg>
          </div>
          <span className="text-[10px] font-medium">None</span>
        </button>

        {/* Loading placeholder */}
        {loading && packs.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border h-[80px]">
            <svg className="animate-spin h-4 w-4 text-muted-foreground mb-1" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[9px] text-muted-foreground">Loading...</span>
          </div>
        )}

        {/* Character cards */}
        {packs.map((pack) => (
          <CharacterCard
            key={pack.id}
            pack={pack}
            selected={selected === pack.id}
            onSelect={() => handleSelect(pack.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CharacterCard({ pack, selected, onSelect }: { pack: ModelPack; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center rounded-lg border-2 transition-all overflow-hidden h-[80px]",
        selected
          ? "border-primary bg-primary/10 shadow-[0_0_12px_rgba(var(--primary-rgb),0.3)]"
          : "border-border hover:border-muted-foreground bg-background",
      )}
    >
      <div className="flex-1 w-full">
        <img
          src={pack.thumbnailUrl}
          alt={pack.name}
          className="w-full h-full object-contain"
        />
      </div>
      <div className="p-1 text-center w-full border-t border-border/50">
        <span className="text-[10px] font-medium">{pack.name}</span>
      </div>
    </button>
  );
}

function CharacterPreview({
  url,
  idleAnimUrl,
  gearConfig,
}: {
  url: string;
  idleAnimUrl: string;
  gearConfig?: GearConfig | null;
}) {
  const { scene } = useGLTF(url);
  const { animations } = useGLTF(idleAnimUrl);

  const clone = useMemo(() => skeletonClone(scene), [scene]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // Apply gear visibility whenever config changes
  useEffect(() => {
    applyGearConfig(clone, gearConfig);
  }, [clone, gearConfig]);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(clone);
    mixerRef.current = mixer;

    // Play an idle clip
    const clip =
      animations.find((a) => a.name === "Idle_A") ??
      animations.find((a) => /idle/i.test(a.name)) ??
      animations.find((a) => a.name !== "T-Pose") ??
      animations[0];
    if (clip) {
      mixer.clipAction(clip).play();
    }

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clone);
    };
  }, [clone, animations]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  return <primitive object={clone} />;
}
