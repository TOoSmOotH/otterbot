/**
 * Package manifest manager.
 *
 * Manages /smoothbot/config/packages.json — a structured list of OS (apt) and
 * npm packages that should be installed at container startup.  The Docker
 * entrypoint reads this file and installs everything before starting the app.
 *
 * npm packages are installed globally with NPM_CONFIG_PREFIX=/smoothbot/tools
 * so they persist on the bind-mounted volume across restarts.  OS (apt)
 * packages live in the container layer and are reinstalled on every start.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface PackageEntry {
  name: string;
  version?: string;
  /** Who added it (e.g. "coo", "user") */
  addedBy?: string;
  /** ISO timestamp */
  addedAt?: string;
}

export interface PackageManifest {
  apt: PackageEntry[];
  npm: PackageEntry[];
}

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "./data";
const MANIFEST_PATH = resolve(WORKSPACE_ROOT, "config", "packages.json");

function ensureDir(): void {
  const dir = dirname(MANIFEST_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Read the current manifest (returns empty lists if file doesn't exist) */
export function readManifest(): PackageManifest {
  if (!existsSync(MANIFEST_PATH)) {
    return { apt: [], npm: [] };
  }
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf-8");
    const data = JSON.parse(raw);
    return {
      apt: Array.isArray(data.apt) ? data.apt : [],
      npm: Array.isArray(data.npm) ? data.npm : [],
    };
  } catch {
    return { apt: [], npm: [] };
  }
}

/** Write the manifest to disk */
function writeManifest(manifest: PackageManifest): void {
  ensureDir();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/** Add an apt package. Returns true if added, false if already present. */
export function addAptPackage(name: string, addedBy?: string): boolean {
  const manifest = readManifest();
  const existing = manifest.apt.find((p) => p.name === name);
  if (existing) return false;

  manifest.apt.push({
    name,
    addedBy: addedBy ?? "unknown",
    addedAt: new Date().toISOString(),
  });
  writeManifest(manifest);
  return true;
}

/** Remove an apt package. Returns true if removed, false if not found. */
export function removeAptPackage(name: string): boolean {
  const manifest = readManifest();
  const idx = manifest.apt.findIndex((p) => p.name === name);
  if (idx === -1) return false;

  manifest.apt.splice(idx, 1);
  writeManifest(manifest);
  return true;
}

/** Add an npm package. Returns true if added, false if already present. */
export function addNpmPackage(name: string, version?: string, addedBy?: string): boolean {
  const manifest = readManifest();
  const existing = manifest.npm.find((p) => p.name === name);
  if (existing) return false;

  manifest.npm.push({
    name,
    version,
    addedBy: addedBy ?? "unknown",
    addedAt: new Date().toISOString(),
  });
  writeManifest(manifest);
  return true;
}

/** Remove an npm package. Returns true if removed, false if not found. */
export function removeNpmPackage(name: string): boolean {
  const manifest = readManifest();
  const idx = manifest.npm.findIndex((p) => p.name === name);
  if (idx === -1) return false;

  manifest.npm.splice(idx, 1);
  writeManifest(manifest);
  return true;
}

/** List all packages in the manifest */
export function listPackages(): PackageManifest {
  return readManifest();
}
