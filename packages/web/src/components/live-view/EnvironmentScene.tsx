import { Suspense, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { SceneConfig, SceneProp } from "@otterbot/shared";
import { useEnvironmentStore } from "../../stores/environment-store";
import * as THREE from "three";

interface EnvironmentSceneProps {
  scene: SceneConfig;
}

export function EnvironmentScene({ scene }: EnvironmentSceneProps) {
  const resolveAssetUrl = useEnvironmentStore((s) => s.resolveAssetUrl);

  // Deduplicate URLs for preloading
  const uniqueUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const prop of scene.props) {
      if (!prop.asset) continue;
      const url = resolveAssetUrl(prop.asset);
      if (url) urls.add(url);
    }
    return [...urls];
  }, [scene.props, resolveAssetUrl]);

  // Preload all unique models
  for (const url of uniqueUrls) {
    useGLTF.preload(url);
  }

  return (
    <group>
      {scene.props.map((prop, i) => {
        const url = resolveAssetUrl(prop.asset);
        if (!url) return null;
        return (
          <Suspense key={`${prop.asset}-${i}`} fallback={null}>
            <ScenePropModel url={url} prop={prop} />
          </Suspense>
        );
      })}
    </group>
  );
}

function ScenePropModel({ url, prop }: { url: string; prop: SceneProp }) {
  const { scene } = useGLTF(url);

  const clone = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (prop.castShadow) child.castShadow = true;
        if (prop.receiveShadow) child.receiveShadow = true;
      }
    });
    return c;
  }, [scene, prop.castShadow, prop.receiveShadow]);

  const scale = useMemo(() => {
    if (!prop.scale) return [1, 1, 1] as [number, number, number];
    if (typeof prop.scale === "number")
      return [prop.scale, prop.scale, prop.scale] as [number, number, number];
    return prop.scale;
  }, [prop.scale]);

  return (
    <primitive
      object={clone}
      position={prop.position}
      rotation={prop.rotation ?? [0, 0, 0]}
      scale={scale}
    />
  );
}
