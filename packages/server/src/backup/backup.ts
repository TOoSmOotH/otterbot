/**
 * Comprehensive backup/restore — bundles the encrypted DB, SSH keys,
 * package manifest, and scene configs into a single ZIP archive.
 */

import { resolve, basename } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  createReadStream,
  createWriteStream,
  copyFileSync,
  unlinkSync,
  chmodSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import yauzl from "yauzl";
import { backupDatabase } from "../db/index.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SSH_KEY_NAME = "otterbot_github";

function sshDir(): string {
  return resolve(homedir(), ".ssh");
}

function sshKeyPath(): string {
  return resolve(sshDir(), SSH_KEY_NAME);
}

function sshPubKeyPath(): string {
  return resolve(sshDir(), `${SSH_KEY_NAME}.pub`);
}

function workspaceRoot(): string {
  return process.env.WORKSPACE_ROOT ?? "./data";
}

function packagesJsonPath(): string {
  return resolve(workspaceRoot(), "config", "packages.json");
}

function scenesDir(assetsRoot: string): string {
  return resolve(assetsRoot, "scenes");
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface BackupManifest {
  version: 1;
  createdAt: string;
  contents: {
    database: boolean;
    sshKey: boolean;
    packages: boolean;
    scenes: string[];
  };
}

// ---------------------------------------------------------------------------
// createBackupArchive
// ---------------------------------------------------------------------------

export async function createBackupArchive(
  tempDir: string,
  assetsRoot: string,
): Promise<string> {
  const zip = new yazl.ZipFile();
  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    contents: { database: true, sshKey: false, packages: false, scenes: [] },
  };

  // 1. Database
  const dbTempPath = resolve(tempDir, `backup-db-${Date.now()}.db`);
  await backupDatabase(dbTempPath);
  zip.addFile(dbTempPath, "otterbot.db");

  // 2. SSH keys
  const privKey = sshKeyPath();
  const pubKey = sshPubKeyPath();
  if (existsSync(privKey)) {
    zip.addFile(privKey, "ssh/otterbot_github");
    manifest.contents.sshKey = true;
  }
  if (existsSync(pubKey)) {
    zip.addFile(pubKey, "ssh/otterbot_github.pub");
  }

  // 3. Package manifest
  const pkgPath = packagesJsonPath();
  if (existsSync(pkgPath)) {
    zip.addFile(pkgPath, "config/packages.json");
    manifest.contents.packages = true;
  }

  // 4. Scene configs
  const sDir = scenesDir(assetsRoot);
  if (existsSync(sDir)) {
    for (const file of readdirSync(sDir)) {
      if (!file.endsWith(".json")) continue;
      zip.addFile(resolve(sDir, file), `scenes/${file}`);
      manifest.contents.scenes.push(file);
    }
  }

  // 5. Manifest (added as buffer so it's always first in the listing)
  zip.addBuffer(
    Buffer.from(JSON.stringify(manifest, null, 2)),
    "manifest.json",
  );

  // Finalize and write to disk
  const zipPath = resolve(tempDir, `otterbot-backup-${Date.now()}.zip`);
  zip.end();

  await pipeline(zip.outputStream, createWriteStream(zipPath));

  // Clean up temp DB
  try { unlinkSync(dbTempPath); } catch { /* ignore */ }

  return zipPath;
}

// ---------------------------------------------------------------------------
// restoreFromArchive
// ---------------------------------------------------------------------------

export async function restoreFromArchive(
  zipPath: string,
  dbKey: string,
  targetDbPath: string,
  assetsRoot: string,
): Promise<{ sshKeyRestored: boolean }> {
  const entries = await extractZip(zipPath);

  // Verify we got a database
  const dbEntry = entries.get("otterbot.db");
  if (!dbEntry) {
    throw new Error("Archive does not contain otterbot.db");
  }

  // Verify DB decryption before touching anything
  const { verifyDatabase } = await import("../db/index.js");
  if (!verifyDatabase(dbEntry, dbKey)) {
    throw new Error("Invalid database file or incorrect encryption key");
  }

  // --- All verification passed, start writing ---

  // Database
  if (existsSync(targetDbPath)) {
    copyFileSync(targetDbPath, targetDbPath + ".bak");
  }
  copyFileSync(dbEntry, targetDbPath);

  // SSH keys
  let sshKeyRestored = false;
  const privKeyEntry = entries.get("ssh/otterbot_github");
  const pubKeyEntry = entries.get("ssh/otterbot_github.pub");

  if (privKeyEntry) {
    const dir = sshDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    copyFileSync(privKeyEntry, sshKeyPath());
    chmodSync(sshKeyPath(), 0o600);
    sshKeyRestored = true;
  }
  if (pubKeyEntry) {
    const dir = sshDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    copyFileSync(pubKeyEntry, sshPubKeyPath());
    chmodSync(sshPubKeyPath(), 0o644);
  }

  // Package manifest
  const pkgEntry = entries.get("config/packages.json");
  if (pkgEntry) {
    const configDir = resolve(workspaceRoot(), "config");
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    copyFileSync(pkgEntry, packagesJsonPath());
  }

  // Scene configs
  const sDir = scenesDir(assetsRoot);
  for (const [entryName, tempPath] of entries) {
    if (!entryName.startsWith("scenes/") || !entryName.endsWith(".json")) continue;
    if (!existsSync(sDir)) {
      mkdirSync(sDir, { recursive: true });
    }
    const filename = basename(entryName);
    copyFileSync(tempPath, resolve(sDir, filename));
  }

  // Clean up all temp files
  for (const tempPath of entries.values()) {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }

  return { sshKeyRestored };
}

// ---------------------------------------------------------------------------
// looksLikeZip
// ---------------------------------------------------------------------------

export function looksLikeZip(filePath: string): boolean {
  try {
    const fd = openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    closeSync(fd);
    // ZIP magic bytes: PK\x03\x04
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ZIP extraction helper
// ---------------------------------------------------------------------------

/**
 * Extracts all entries from a ZIP to temp files.
 * Returns a Map of entryName → tempFilePath.
 */
async function extractZip(zipPath: string): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  const tempDir = resolve(zipPath, "..");

  return new Promise((resolveP, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) return reject(err ?? new Error("Failed to open ZIP"));

      zipFile.readEntry();
      zipFile.on("entry", (entry) => {
        // Skip directories
        if (entry.fileName.endsWith("/")) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            return reject(streamErr ?? new Error(`Failed to read ${entry.fileName}`));
          }

          const safeName = entry.fileName.replace(/[/\\]/g, "_");
          const tempPath = resolve(tempDir, `entry-${safeName}-${Date.now()}`);
          const ws = createWriteStream(tempPath);

          readStream.pipe(ws);
          ws.on("finish", () => {
            entries.set(entry.fileName, tempPath);
            zipFile.readEntry();
          });
          ws.on("error", reject);
        });
      });

      zipFile.on("end", () => resolveP(entries));
      zipFile.on("error", reject);
    });
  });
}
