/**
 * Module installer — handles git, npm, and local module sources.
 */

import { resolve, basename } from "node:path";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  lstatSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import type {
  ModuleSource,
  InstalledModule,
  ModuleDefinition,
} from "@otterbot/shared";
import {
  addModule,
  removeModule,
  getModule,
  updateModule,
} from "./module-manifest.js";

function modulesDir(): string {
  const wsRoot = process.env.WORKSPACE_ROOT ?? "./data";
  return resolve(wsRoot, "modules");
}

function moduleDataDir(moduleId: string): string {
  return resolve(modulesDir(), moduleId);
}

/**
 * Dynamically import a module definition from its main entry.
 * Expects the module to export default (or named) a ModuleDefinition.
 */
async function loadModuleDefinition(
  modulePath: string,
): Promise<ModuleDefinition> {
  // Try to find the entry point
  let entryPath: string;

  // Check package.json for main/exports
  const pkgJsonPath = resolve(modulePath, "package.json");
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const main = pkg.exports?.["./"] ?? pkg.exports?.["."] ?? pkg.main ?? "dist/index.js";
    entryPath = resolve(modulePath, main);
  } else {
    entryPath = resolve(modulePath, "dist/index.js");
  }

  if (!existsSync(entryPath)) {
    // Try src/index.ts as fallback for ts modules loaded by tsx
    const srcEntry = resolve(modulePath, "src/index.ts");
    if (existsSync(srcEntry)) {
      entryPath = srcEntry;
    } else {
      throw new Error(`Module entry point not found: ${entryPath}`);
    }
  }

  const mod = await import(entryPath);
  const definition: ModuleDefinition = mod.default ?? mod;

  if (!definition?.manifest?.id) {
    throw new Error(`Module at ${modulePath} does not export a valid ModuleDefinition`);
  }

  return definition;
}

/**
 * Install a module from a git repository URL.
 */
export async function installFromGit(
  sourceUri: string,
  instanceId?: string,
): Promise<InstalledModule> {
  // Clone the repo
  const repoName = basename(sourceUri, ".git").replace(/^otterbot-module-/, "");
  const id = instanceId ?? repoName;
  const targetDir = moduleDataDir(id);

  if (existsSync(targetDir)) {
    throw new Error(`Module directory already exists: ${targetDir}`);
  }

  mkdirSync(targetDir, { recursive: true });

  try {
    execSync(`git clone ${sourceUri} ${targetDir}`, {
      stdio: "pipe",
      timeout: 120_000,
    });

    // Install deps and build
    if (existsSync(resolve(targetDir, "package.json"))) {
      execSync("npx pnpm install --frozen-lockfile", {
        cwd: targetDir,
        stdio: "pipe",
        timeout: 120_000,
      });

      const pkg = JSON.parse(readFileSync(resolve(targetDir, "package.json"), "utf-8"));
      if (pkg.scripts?.build) {
        execSync("npx pnpm build", {
          cwd: targetDir,
          stdio: "pipe",
          timeout: 120_000,
        });
      }
    }

    const definition = await loadModuleDefinition(targetDir);

    const entry: InstalledModule = {
      id: instanceId ?? definition.manifest.id,
      moduleId: definition.manifest.id,
      name: definition.manifest.name,
      version: definition.manifest.version,
      source: "git",
      sourceUri,
      enabled: true,
      modulePath: targetDir,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    addModule(entry);
    return entry;
  } catch (err) {
    // Cleanup on failure
    try { rmSync(targetDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Install a module from a local path (creates symlink).
 */
export async function installFromLocal(
  sourcePath: string,
  instanceId?: string,
): Promise<InstalledModule> {
  const absPath = resolve(sourcePath);
  if (!existsSync(absPath)) {
    throw new Error(`Local module path does not exist: ${absPath}`);
  }

  const definition = await loadModuleDefinition(absPath);
  const id = instanceId ?? definition.manifest.id;
  const targetDir = moduleDataDir(id);

  // Create data dir and symlink for the module code
  mkdirSync(resolve(modulesDir()), { recursive: true });

  if (existsSync(targetDir)) {
    // If it's already a symlink pointing to the same place, update the manifest
    if (lstatSync(targetDir).isSymbolicLink()) {
      // ok, just update
    } else {
      throw new Error(`Module directory already exists: ${targetDir}`);
    }
  } else {
    symlinkSync(absPath, targetDir);
  }

  const entry: InstalledModule = {
    id,
    moduleId: definition.manifest.id,
    name: definition.manifest.name,
    version: definition.manifest.version,
    source: "local",
    sourceUri: absPath,
    enabled: true,
    modulePath: absPath,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  addModule(entry);
  return entry;
}

/**
 * Install a module from npm.
 */
export async function installFromNpm(
  packageName: string,
  instanceId?: string,
): Promise<InstalledModule> {
  // Install the package into the server
  const serverRoot = resolve(import.meta.dirname, "../..");
  execSync(`npx pnpm add ${packageName}`, {
    cwd: serverRoot,
    stdio: "pipe",
    timeout: 120_000,
  });

  // Import the module
  const mod = await import(packageName);
  const definition: ModuleDefinition = mod.default ?? mod;

  if (!definition?.manifest?.id) {
    throw new Error(`Package ${packageName} does not export a valid ModuleDefinition`);
  }

  const id = instanceId ?? definition.manifest.id;

  // Create data directory for the module's knowledge DB
  const dataDir = moduleDataDir(id);
  mkdirSync(dataDir, { recursive: true });

  // Resolve the installed module path via require.resolve
  let modulePath: string;
  try {
    const resolved = import.meta.resolve(packageName);
    modulePath = new URL(resolved).pathname;
    // Get the package root (up to node_modules/package-name)
    const nmIdx = modulePath.lastIndexOf("node_modules");
    if (nmIdx >= 0) {
      const parts = modulePath.substring(nmIdx + "node_modules/".length).split("/");
      const pkgDir = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      modulePath = resolve(modulePath.substring(0, nmIdx + "node_modules/".length), pkgDir);
    }
  } catch {
    modulePath = packageName; // fallback
  }

  const entry: InstalledModule = {
    id,
    moduleId: definition.manifest.id,
    name: definition.manifest.name,
    version: definition.manifest.version,
    source: "npm",
    sourceUri: packageName,
    enabled: true,
    modulePath,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  addModule(entry);
  return entry;
}

/**
 * Uninstall a module.
 */
export async function uninstallModule(id: string): Promise<void> {
  const entry = getModule(id);
  if (!entry) {
    throw new Error(`Module not found: ${id}`);
  }

  if (entry.source === "npm") {
    try {
      const serverRoot = resolve(import.meta.dirname, "../..");
      execSync(`npx pnpm remove ${entry.sourceUri}`, {
        cwd: serverRoot,
        stdio: "pipe",
        timeout: 60_000,
      });
    } catch { /* package may already be removed */ }
  }

  // Remove data directory (or symlink)
  const dataDir = moduleDataDir(id);
  if (existsSync(dataDir)) {
    if (lstatSync(dataDir).isSymbolicLink()) {
      rmSync(dataDir);
    } else if (entry.source === "git") {
      rmSync(dataDir, { recursive: true, force: true });
    }
    // For local modules that aren't symlinks, we leave the data
  }

  removeModule(id);
}

/**
 * Upgrade a git-sourced module.
 */
export async function upgradeModule(id: string): Promise<InstalledModule> {
  const entry = getModule(id);
  if (!entry) {
    throw new Error(`Module not found: ${id}`);
  }

  if (entry.source === "git") {
    execSync("git pull", {
      cwd: entry.modulePath,
      stdio: "pipe",
      timeout: 60_000,
    });

    if (existsSync(resolve(entry.modulePath, "package.json"))) {
      execSync("npx pnpm install --frozen-lockfile", {
        cwd: entry.modulePath,
        stdio: "pipe",
        timeout: 120_000,
      });

      const pkg = JSON.parse(readFileSync(resolve(entry.modulePath, "package.json"), "utf-8"));
      if (pkg.scripts?.build) {
        execSync("npx pnpm build", {
          cwd: entry.modulePath,
          stdio: "pipe",
          timeout: 120_000,
        });
      }
    }

    const definition = await loadModuleDefinition(entry.modulePath);

    updateModule(id, {
      version: definition.manifest.version,
      updatedAt: new Date().toISOString(),
    });

    return { ...entry, version: definition.manifest.version, updatedAt: new Date().toISOString() };
  } else if (entry.source === "npm") {
    const serverRoot = resolve(import.meta.dirname, "../..");
    execSync(`npx pnpm update ${entry.sourceUri}`, {
      cwd: serverRoot,
      stdio: "pipe",
      timeout: 120_000,
    });

    const mod = await import(entry.sourceUri);
    const definition: ModuleDefinition = mod.default ?? mod;

    updateModule(id, {
      version: definition.manifest.version,
      updatedAt: new Date().toISOString(),
    });

    return { ...entry, version: definition.manifest.version, updatedAt: new Date().toISOString() };
  }

  // Local modules — just re-read the definition
  const definition = await loadModuleDefinition(entry.modulePath);
  updateModule(id, {
    version: definition.manifest.version,
    updatedAt: new Date().toISOString(),
  });

  return { ...entry, version: definition.manifest.version, updatedAt: new Date().toISOString() };
}

export { loadModuleDefinition };
