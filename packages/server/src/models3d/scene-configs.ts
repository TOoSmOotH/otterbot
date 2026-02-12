import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SceneConfig } from "@smoothbot/shared";

export function discoverSceneConfigs(assetsRoot: string): SceneConfig[] {
  const scenesDir = resolve(assetsRoot, "scenes");
  if (!existsSync(scenesDir)) return [];

  const configs: SceneConfig[] = [];

  for (const file of readdirSync(scenesDir)) {
    if (!file.endsWith(".json")) continue;

    try {
      const raw = readFileSync(resolve(scenesDir, file), "utf-8");
      const config = JSON.parse(raw) as SceneConfig;
      configs.push(config);
    } catch (err) {
      console.error(`[scene-configs] Failed to load ${file}:`, err);
    }
  }

  return configs;
}
