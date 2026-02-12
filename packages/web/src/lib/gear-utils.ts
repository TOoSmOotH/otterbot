import * as THREE from "three";
import type { GearConfig } from "@smoothbot/shared";

/**
 * Body-part mesh name patterns — these are never treated as gear.
 * Matches names like Hoarder_Body, Hoarder_Head, Hoarder_ArmLeft,
 * Hoarder_LegRight, etc. but NOT compound words like Hoarder_CollarArmor.
 */
const BODY_PATTERNS = [
  /_Body$/i,
  /_Head$/i,
  /_Arm(Left|Right|_L|_R)$/i,
  /_Leg(Left|Right|_L|_R)$/i,
];

function isBodyPart(name: string): boolean {
  return BODY_PATTERNS.some((p) => p.test(name));
}

/**
 * Walk a loaded GLB scene and return the names of every Mesh child
 * that is NOT a body part (i.e. gear / equipment).
 */
export function discoverGearMeshes(scene: THREE.Object3D): string[] {
  const names: string[] = [];
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.name && !isBodyPart(child.name)) {
      names.push(child.name);
    }
  });
  return names;
}

/**
 * Apply a gear config to a scene — meshes whose name maps to `false`
 * are hidden; everything else stays visible.
 */
export function applyGearConfig(scene: THREE.Object3D, config: GearConfig | null | undefined): void {
  if (!config) return;
  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.name && child.name in config) {
      child.visible = config[child.name] !== false;
    }
  });
}

/**
 * Turn a raw mesh name like `"Hoarder_FrontPouch_Sword"` into a
 * human-readable label: `"Front Pouch Sword"`.
 *
 * Strips the character-name prefix (everything before the first `_`)
 * and inserts spaces before uppercase letters.
 */
export function formatGearName(meshName: string): string {
  // Drop the character prefix (e.g. "Hoarder_")
  const parts = meshName.split("_").slice(1);
  if (parts.length === 0) return meshName;

  return parts
    .map((p) => p.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" ");
}
