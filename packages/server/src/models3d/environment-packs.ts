import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { EnvironmentPack } from "@smoothbot/shared";

export function discoverEnvironmentPacks(assetsRoot: string): EnvironmentPack[] {
  const envsDir = resolve(assetsRoot, "environments");
  if (!existsSync(envsDir)) return [];

  const packs: EnvironmentPack[] = [];

  for (const dir of readdirSync(envsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;

    const modelsDir = resolve(envsDir, dir.name, "models");
    if (!existsSync(modelsDir)) continue;

    const gltfFiles = readdirSync(modelsDir).filter((f) => f.endsWith(".gltf"));
    if (gltfFiles.length === 0) continue;

    const prefix = `/assets/3d/environments/${dir.name}/models`;

    packs.push({
      id: dir.name,
      name: dir.name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      assets: gltfFiles.map((f) => {
        const id = f.replace(/\.gltf$/, "");
        return {
          id,
          name: id.replace(/_/g, " "),
          modelUrl: `${prefix}/${f}`,
        };
      }),
    });
  }

  return packs;
}
