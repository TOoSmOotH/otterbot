/**
 * Manages the installed modules manifest at ./data/config/modules-manifest.json.
 */

import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { ModulesManifest, InstalledModule } from "@otterbot/shared";

function manifestPath(): string {
  const wsRoot = process.env.WORKSPACE_ROOT ?? "./data";
  return resolve(wsRoot, "config", "modules-manifest.json");
}

function emptyManifest(): ModulesManifest {
  return { version: 1, modules: [] };
}

export function readManifest(): ModulesManifest {
  const p = manifestPath();
  if (!existsSync(p)) return emptyManifest();
  try {
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as ModulesManifest;
  } catch {
    return emptyManifest();
  }
}

export function writeManifest(manifest: ModulesManifest): void {
  const p = manifestPath();
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2));
}

export function addModule(entry: InstalledModule): void {
  const manifest = readManifest();
  const idx = manifest.modules.findIndex((m) => m.id === entry.id);
  if (idx >= 0) {
    manifest.modules[idx] = entry;
  } else {
    manifest.modules.push(entry);
  }
  writeManifest(manifest);
}

export function removeModule(id: string): void {
  const manifest = readManifest();
  manifest.modules = manifest.modules.filter((m) => m.id !== id);
  writeManifest(manifest);
}

export function getModule(id: string): InstalledModule | undefined {
  return readManifest().modules.find((m) => m.id === id);
}

export function listModules(): InstalledModule[] {
  return readManifest().modules;
}

export function updateModule(id: string, updates: Partial<InstalledModule>): void {
  const manifest = readManifest();
  const idx = manifest.modules.findIndex((m) => m.id === id);
  if (idx >= 0) {
    manifest.modules[idx] = { ...manifest.modules[idx], ...updates };
    writeManifest(manifest);
  }
}
