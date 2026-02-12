import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelPack } from "@smoothbot/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = resolve(__dirname, "../../../../assets/workers");

export function discoverModelPacks(): ModelPack[] {
  if (!existsSync(ASSETS_ROOT)) return [];

  const packs: ModelPack[] = [];

  for (const dir of readdirSync(ASSETS_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;

    const packDir = resolve(ASSETS_ROOT, dir.name);
    const characterDir = resolve(packDir, "characters");
    const animDir = resolve(packDir, "Animations/gltf/Rig_Medium");

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
    if (existsSync(animDir)) {
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

    packs.push({
      id: dir.name,
      name: dir.name.charAt(0).toUpperCase() + dir.name.slice(1),
      characterUrl: `${prefix}/characters/${characterFile}`,
      thumbnailUrl: hasArtwork
        ? `${prefix}/artwork.png`
        : `${prefix}/characters/${characterFile}`,
      animations: {
        idle: idleAnim
          ? `${prefix}/Animations/gltf/Rig_Medium/${idleAnim}`
          : `${prefix}/characters/${characterFile}`,
        action: actionAnim
          ? `${prefix}/Animations/gltf/Rig_Medium/${actionAnim}`
          : `${prefix}/characters/${characterFile}`,
      },
    });
  }

  return packs;
}
