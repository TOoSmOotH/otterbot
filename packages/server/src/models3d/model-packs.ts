import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ModelPack } from "@smoothbot/shared";

export function discoverModelPacks(assetsRoot: string): ModelPack[] {
  const workersDir = resolve(assetsRoot, "workers");
  if (!existsSync(workersDir)) return [];

  const packs: ModelPack[] = [];

  for (const dir of readdirSync(workersDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;

    const packDir = resolve(workersDir, dir.name);
    const characterDir = resolve(packDir, "characters");

    // Auto-detect rig size (Rig_Medium or Rig_Large)
    const animGltfDir = resolve(packDir, "Animations/gltf");
    let rigSize: string | null = null;
    let animDir: string | null = null;
    if (existsSync(animGltfDir)) {
      for (const candidate of ["Rig_Medium", "Rig_Large"]) {
        const candidateDir = resolve(animGltfDir, candidate);
        if (existsSync(candidateDir)) {
          rigSize = candidate;
          animDir = candidateDir;
          break;
        }
      }
    }

    // Look for character GLB
    let characterFile: string | null = null;
    if (existsSync(characterDir)) {
      const glbFiles = readdirSync(characterDir).filter((f) =>
        f.endsWith(".glb"),
      );
      if (glbFiles.length > 0) characterFile = glbFiles[0];
    }

    if (!characterFile) continue;

    // Look for animation GLBs
    let idleAnim: string | null = null;
    let actionAnim: string | null = null;
    if (animDir) {
      const animFiles = readdirSync(animDir).filter((f) => f.endsWith(".glb"));
      for (const f of animFiles) {
        if (f.includes("General")) idleAnim = f;
        if (f.includes("Movement")) actionAnim = f;
      }
    }

    // Look for artwork
    const artworkPath = resolve(packDir, "artwork.png");
    const hasArtwork = existsSync(artworkPath);

    const prefix = `/assets/3d/workers/${dir.name}`;
    const animPrefix = rigSize ? `${prefix}/Animations/gltf/${rigSize}` : null;

    // Derive display name: "orc-brute" -> "Orc Brute"
    const name = dir.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    packs.push({
      id: dir.name,
      name,
      characterUrl: `${prefix}/characters/${characterFile}`,
      thumbnailUrl: hasArtwork
        ? `${prefix}/artwork.png`
        : `${prefix}/characters/${characterFile}`,
      animations: {
        idle:
          idleAnim && animPrefix
            ? `${animPrefix}/${idleAnim}`
            : `${prefix}/characters/${characterFile}`,
        action:
          actionAnim && animPrefix
            ? `${animPrefix}/${actionAnim}`
            : `${prefix}/characters/${characterFile}`,
      },
    });
  }

  return packs;
}
