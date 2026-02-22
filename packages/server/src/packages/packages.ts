/**
 * Package manifest manager.
 *
 * Manages /otterbot/config/packages.json — a structured list of OS (apt) and
 * npm packages that should be installed at container startup.  The Docker
 * entrypoint reads this file and installs everything before starting the app.
 *
 * npm packages are installed globally with NPM_CONFIG_PREFIX=/otterbot/tools
 * so they persist on the bind-mounted volume across restarts.  OS (apt)
 * packages live in the container layer and are reinstalled on every start.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Sudo configuration
// ---------------------------------------------------------------------------

/** Whether to use sudo for system commands. Set OTTERBOT_USE_SUDO=false to disable. */
const USE_SUDO = (process.env.OTTERBOT_USE_SUDO ?? "true").toLowerCase() !== "false";

/**
 * Execute a command with optional sudo prefix.
 * When OTTERBOT_USE_SUDO is false, runs the command directly without sudo.
 */
function execWithOptionalSudo(
  cmd: string,
  args: string[],
  opts: Parameters<typeof execFileSync>[2],
): Buffer {
  if (USE_SUDO) {
    return execFileSync("sudo", [cmd, ...args], opts) as Buffer;
  }
  return execFileSync(cmd, args, opts) as Buffer;
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const PACKAGE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._@/\-]*$/;
const MAX_PACKAGE_NAME_LEN = 214;

function validatePackageName(name: string): void {
  if (!name || name.length > MAX_PACKAGE_NAME_LEN || !PACKAGE_NAME_RE.test(name)) {
    throw new Error(`Invalid package name: ${name}`);
  }
}

function validateKeyUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error(`Key URL must use https: scheme, got ${parsed.protocol}`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Key URL must use")) throw err;
    throw new Error(`Invalid key URL: ${url}`);
  }
}

function validateKeyPath(path: string): void {
  const resolved = resolve(path);
  if (!resolved.startsWith("/etc/apt/keyrings/")) {
    throw new Error(`Key path must be under /etc/apt/keyrings/, got ${resolved}`);
  }
}

export interface PackageEntry {
  name: string;
  version?: string;
  /** Who added it (e.g. "coo", "user") */
  addedBy?: string;
  /** ISO timestamp */
  addedAt?: string;
}

export interface RepoEntry {
  /** Short identifier, e.g. "nodesource" or "docker" */
  name: string;
  /** Full deb line, e.g. "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" */
  source: string;
  /** URL to the GPG key */
  keyUrl: string;
  /** Path to store the dearmored key, e.g. "/etc/apt/keyrings/nodesource.gpg" */
  keyPath: string;
  addedBy?: string;
  addedAt?: string;
}

export interface PackageManifest {
  apt: PackageEntry[];
  npm: PackageEntry[];
  repos: RepoEntry[];
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
    return { apt: [], npm: [], repos: [] };
  }
  try {
    const raw = readFileSync(MANIFEST_PATH, "utf-8");
    const data = JSON.parse(raw);
    return {
      apt: Array.isArray(data.apt) ? data.apt : [],
      npm: Array.isArray(data.npm) ? data.npm : [],
      repos: Array.isArray(data.repos) ? data.repos : [],
    };
  } catch {
    return { apt: [], npm: [], repos: [] };
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

/** Add a repo entry to the manifest. Returns true if added, false if already present. */
export function addRepo(repo: Omit<RepoEntry, "addedAt">): boolean {
  const manifest = readManifest();
  const existing = manifest.repos.find((r) => r.name === repo.name);
  if (existing) return false;

  manifest.repos.push({
    ...repo,
    addedAt: new Date().toISOString(),
  });
  writeManifest(manifest);
  return true;
}

/** Remove a repo entry from the manifest. Returns true if removed, false if not found. */
export function removeRepo(name: string): boolean {
  const manifest = readManifest();
  const idx = manifest.repos.findIndex((r) => r.name === name);
  if (idx === -1) return false;

  manifest.repos.splice(idx, 1);
  writeManifest(manifest);
  return true;
}

/** List all packages in the manifest */
export function listPackages(): PackageManifest {
  return readManifest();
}

// ---------------------------------------------------------------------------
// Live installation — runs immediately via sudo (no restart required)
// ---------------------------------------------------------------------------

export interface InstallResult {
  success: boolean;
  alreadyInManifest: boolean;
  output?: string;
  error?: string;
}

/** Install an apt package immediately via sudo and add to manifest */
export function installAptPackage(name: string, addedBy?: string): InstallResult {
  validatePackageName(name);
  const alreadyInManifest = !addAptPackage(name, addedBy);

  try {
    execWithOptionalSudo("apt-get", ["update"], { stdio: "pipe", timeout: 60_000 });
    const output = execWithOptionalSudo(
      "apt-get", ["install", "-y", "--no-install-recommends", name],
      { stdio: "pipe", timeout: 120_000 },
    );
    return {
      success: true,
      alreadyInManifest,
      output: output.toString().slice(-500),
    };
  } catch (err) {
    // Remove from manifest if install failed and we just added it
    if (!alreadyInManifest) {
      removeAptPackage(name);
    }
    return {
      success: false,
      alreadyInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Install an npm package immediately (global) and add to manifest */
export function installNpmPackage(
  name: string,
  version?: string,
  addedBy?: string,
): InstallResult {
  validatePackageName(name);
  if (version) validatePackageName(version);
  const alreadyInManifest = !addNpmPackage(name, version, addedBy);
  const spec = version ? `${name}@${version}` : name;

  try {
    const output = execWithOptionalSudo("npm", ["install", "-g", spec], {
      stdio: "pipe",
      timeout: 180_000,
      env: { ...process.env, NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX ?? "/otterbot/tools" },
    });
    return {
      success: true,
      alreadyInManifest,
      output: output.toString().slice(-500),
    };
  } catch (err) {
    // Remove from manifest if install failed and we just added it
    if (!alreadyInManifest) {
      removeNpmPackage(name);
    }
    return {
      success: false,
      alreadyInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Uninstall an apt package immediately via sudo and remove from manifest */
export function uninstallAptPackage(name: string): InstallResult {
  validatePackageName(name);
  const wasInManifest = removeAptPackage(name);

  try {
    const output = execWithOptionalSudo(
      "apt-get", ["remove", "-y", name],
      { stdio: "pipe", timeout: 120_000 },
    );
    return {
      success: true,
      alreadyInManifest: !wasInManifest,
      output: output.toString().slice(-500),
    };
  } catch (err) {
    return {
      success: false,
      alreadyInManifest: !wasInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Uninstall an npm package immediately (global) and remove from manifest */
export function uninstallNpmPackage(name: string): InstallResult {
  validatePackageName(name);
  const wasInManifest = removeNpmPackage(name);

  try {
    const output = execWithOptionalSudo("npm", ["uninstall", "-g", name], {
      stdio: "pipe",
      timeout: 60_000,
      env: { ...process.env, NPM_CONFIG_PREFIX: process.env.NPM_CONFIG_PREFIX ?? "/otterbot/tools" },
    });
    return {
      success: true,
      alreadyInManifest: !wasInManifest,
      output: output.toString().slice(-500),
    };
  } catch (err) {
    return {
      success: false,
      alreadyInManifest: !wasInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Repository management — add/remove apt sources and GPG keys
// ---------------------------------------------------------------------------

/** Add an apt repository: download GPG key, write source file, update apt cache */
export function installRepo(
  repo: Omit<RepoEntry, "addedAt">,
): InstallResult {
  validatePackageName(repo.name);
  validateKeyUrl(repo.keyUrl);
  validateKeyPath(repo.keyPath);
  const alreadyInManifest = !addRepo(repo);

  try {
    // Create keyrings directory if needed
    execWithOptionalSudo("install", ["-m", "0755", "-d", "/etc/apt/keyrings"], {
      stdio: "pipe",
      timeout: 30_000,
    });

    // Download the GPG key (to a temp file, then dearmor)
    const tmpKeyPath = `/tmp/otterbot-key-${repo.name}.gpg`;
    execFileSync("curl", ["-fsSL", "-o", tmpKeyPath, repo.keyUrl], {
      stdio: "pipe",
      timeout: 30_000,
    });
    execWithOptionalSudo("gpg", ["--dearmor", "-o", repo.keyPath, tmpKeyPath], {
      stdio: "pipe",
      timeout: 30_000,
    });

    // Write the sources list file safely (write to tmp, then sudo cp)
    const sourcesPath = `/etc/apt/sources.list.d/${repo.name}.list`;
    const tmpSourcesPath = `/tmp/otterbot-sources-${repo.name}.list`;
    writeFileSync(tmpSourcesPath, repo.source + "\n", "utf-8");
    execWithOptionalSudo("cp", [tmpSourcesPath, sourcesPath], {
      stdio: "pipe",
      timeout: 10_000,
    });

    // Update apt cache for the new repo
    execWithOptionalSudo("apt-get", ["update"], { stdio: "pipe", timeout: 60_000 });

    return { success: true, alreadyInManifest };
  } catch (err) {
    if (!alreadyInManifest) {
      removeRepo(repo.name);
    }
    return {
      success: false,
      alreadyInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Remove an apt repository: delete source file and GPG key */
export function uninstallRepo(name: string): InstallResult {
  validatePackageName(name);
  const manifest = readManifest();
  const repo = manifest.repos.find((r) => r.name === name);
  const wasInManifest = removeRepo(name);

  try {
    // Remove sources list file
    const sourcesPath = `/etc/apt/sources.list.d/${name}.list`;
    try {
      execWithOptionalSudo("rm", ["-f", sourcesPath], { stdio: "pipe", timeout: 10_000 });
    } catch { /* ignore if file doesn't exist */ }

    // Remove GPG key
    if (repo?.keyPath) {
      validateKeyPath(repo.keyPath);
      try {
        execWithOptionalSudo("rm", ["-f", repo.keyPath], { stdio: "pipe", timeout: 10_000 });
      } catch { /* ignore if file doesn't exist */ }
    }

    // Update apt cache
    execWithOptionalSudo("apt-get", ["update"], { stdio: "pipe", timeout: 60_000 });

    return { success: true, alreadyInManifest: !wasInManifest };
  } catch (err) {
    return {
      success: false,
      alreadyInManifest: !wasInManifest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
