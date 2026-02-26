import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { SshKeyInfo, SshKeyType, SshSession, SshSessionStatus } from "@otterbot/shared";

const MAX_OUTPUT_SIZE = 50_000; // 50KB
const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const CONNECT_TIMEOUT = 10; // seconds

/** Commands blocked from one-shot exec to prevent destructive remote actions */
const BLOCKED_REMOTE_COMMANDS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/, reason: "rm targeting root filesystem is not permitted" },
  { pattern: /\bmkfs\b/, reason: "Formatting filesystems is not permitted" },
  { pattern: /\bdd\b.*\bof=\/dev\//, reason: "Raw disk writes are not permitted" },
  { pattern: /\bshutdown\b/, reason: "System shutdown is not permitted" },
  { pattern: /\breboot\b/, reason: "System reboot is not permitted" },
  { pattern: /\bhalt\b/, reason: "System halt is not permitted" },
  { pattern: /\bpoweroff\b/, reason: "System poweroff is not permitted" },
];

function getSshKeyDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const dir = join(home, ".ssh");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function getKeyPath(id: string): string {
  return join(getSshKeyDir(), `otterbot_ssh_${id}`);
}

export class SshService {
  /** List all SSH keys */
  list(): SshKeyInfo[] {
    const db = getDb();
    const rows = db.select().from(schema.sshKeys).orderBy(desc(schema.sshKeys.createdAt)).all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username,
      fingerprint: r.fingerprint,
      keyType: r.keyType,
      allowedHosts: r.allowedHosts,
      port: r.port,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /** Get a single SSH key by ID */
  get(id: string): SshKeyInfo | null {
    const db = getDb();
    const row = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      fingerprint: row.fingerprint,
      keyType: row.keyType,
      allowedHosts: row.allowedHosts,
      port: row.port,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Generate a new SSH key pair */
  generateKey(opts: {
    name: string;
    username: string;
    allowedHosts: string[];
    keyType?: SshKeyType;
    port?: number;
  }): SshKeyInfo {
    const id = nanoid();
    const keyPath = getKeyPath(id);
    const keyType = opts.keyType ?? "ed25519";

    // Generate key pair
    execSync(
      `ssh-keygen -t ${keyType} -f ${keyPath} -N "" -C "otterbot-${opts.name}"`,
      { stdio: "pipe" },
    );

    // Set permissions
    chmodSync(keyPath, 0o600);
    chmodSync(`${keyPath}.pub`, 0o644);

    // Get fingerprint
    const fingerprint = execSync(`ssh-keygen -lf ${keyPath}.pub`, { encoding: "utf-8" }).trim();

    const now = new Date().toISOString();
    const db = getDb();
    db.insert(schema.sshKeys)
      .values({
        id,
        name: opts.name,
        username: opts.username,
        privateKeyPath: keyPath,
        fingerprint,
        keyType,
        allowedHosts: opts.allowedHosts,
        port: opts.port ?? 22,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id,
      name: opts.name,
      username: opts.username,
      fingerprint,
      keyType,
      allowedHosts: opts.allowedHosts,
      port: opts.port ?? 22,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Import an existing private key */
  importKey(opts: {
    name: string;
    username: string;
    privateKey: string;
    allowedHosts: string[];
    port?: number;
  }): SshKeyInfo {
    const id = nanoid();
    const keyPath = getKeyPath(id);

    // Write private key
    writeFileSync(keyPath, opts.privateKey, { mode: 0o600 });

    // Derive public key
    try {
      execSync(`ssh-keygen -y -f ${keyPath} > ${keyPath}.pub`, { stdio: "pipe" });
      chmodSync(`${keyPath}.pub`, 0o644);
    } catch (err) {
      // Clean up on failure
      try { unlinkSync(keyPath); } catch { /* ignore */ }
      throw new Error("Invalid private key: could not derive public key");
    }

    // Get fingerprint
    const fingerprint = execSync(`ssh-keygen -lf ${keyPath}.pub`, { encoding: "utf-8" }).trim();

    // Detect key type from fingerprint line (e.g. "256 SHA256:... comment (ED25519)")
    let keyType: SshKeyType = "ed25519";
    if (/\(RSA\)/i.test(fingerprint)) {
      keyType = "rsa";
    }

    const now = new Date().toISOString();
    const db = getDb();
    db.insert(schema.sshKeys)
      .values({
        id,
        name: opts.name,
        username: opts.username,
        privateKeyPath: keyPath,
        fingerprint,
        keyType,
        allowedHosts: opts.allowedHosts,
        port: opts.port ?? 22,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id,
      name: opts.name,
      username: opts.username,
      fingerprint,
      keyType,
      allowedHosts: opts.allowedHosts,
      port: opts.port ?? 22,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Delete an SSH key and its files */
  deleteKey(id: string): boolean {
    const db = getDb();
    const row = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
    if (!row) return false;

    // Remove key files
    try { unlinkSync(row.privateKeyPath); } catch { /* ignore */ }
    try { unlinkSync(`${row.privateKeyPath}.pub`); } catch { /* ignore */ }

    db.delete(schema.sshKeys).where(eq(schema.sshKeys.id, id)).run();
    return true;
  }

  /** Update SSH key metadata */
  update(
    id: string,
    data: { name?: string; username?: string; allowedHosts?: string[]; port?: number },
  ): SshKeyInfo | null {
    const db = getDb();
    const existing = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
    if (!existing) return null;

    const now = new Date().toISOString();
    db.update(schema.sshKeys)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.username !== undefined && { username: data.username }),
        ...(data.allowedHosts !== undefined && { allowedHosts: data.allowedHosts }),
        ...(data.port !== undefined && { port: data.port }),
        updatedAt: now,
      })
      .where(eq(schema.sshKeys.id, id))
      .run();

    return this.get(id);
  }

  /** Get the public key text for a key */
  getPublicKey(id: string): string | null {
    const db = getDb();
    const row = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
    if (!row) return null;

    const pubPath = `${row.privateKeyPath}.pub`;
    if (!existsSync(pubPath)) return null;
    return readFileSync(pubPath, "utf-8").trim();
  }

  /** Validate that a host is in the key's allowlist */
  validateHost(keyId: string, host: string): { ok: boolean; error?: string } {
    const key = this.get(keyId);
    if (!key) return { ok: false, error: "SSH key not found" };
    if (key.allowedHosts.length === 0) return { ok: false, error: "No hosts configured for this key" };
    if (!key.allowedHosts.includes(host)) {
      return { ok: false, error: `Host "${host}" is not in the allowlist for key "${key.name}". Allowed: ${key.allowedHosts.join(", ")}` };
    }
    return { ok: true };
  }

  /** Execute a command on a remote host (one-shot) */
  exec(opts: {
    keyId: string;
    host: string;
    command: string;
    timeout?: number;
  }): { ok: boolean; output?: string; error?: string } {
    // Validate host
    const hostCheck = this.validateHost(opts.keyId, opts.host);
    if (!hostCheck.ok) return { ok: false, error: hostCheck.error };

    // Check blocked commands
    for (const blocked of BLOCKED_REMOTE_COMMANDS) {
      if (blocked.pattern.test(opts.command)) {
        return { ok: false, error: `Blocked command: ${blocked.reason}` };
      }
    }

    const key = this.get(opts.keyId)!;
    const db = getDb();
    const row = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, opts.keyId)).get()!;
    const keyPath = row.privateKeyPath;

    const timeout = Math.min(opts.timeout ?? DEFAULT_TIMEOUT, DEFAULT_TIMEOUT);

    const sshArgs = [
      "ssh",
      "-i", keyPath,
      "-o", "BatchMode=yes",
      "-o", `ConnectTimeout=${CONNECT_TIMEOUT}`,
      "-o", "StrictHostKeyChecking=accept-new",
      "-p", String(key.port),
      `${key.username}@${opts.host}`,
      opts.command,
    ];

    try {
      let output = execSync(sshArgs.join(" "), {
        encoding: "utf-8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Cap output
      if (output.length > MAX_OUTPUT_SIZE) {
        output = output.slice(0, MAX_OUTPUT_SIZE) + "\n... (output truncated at 50KB)";
      }

      return { ok: true, output };
    } catch (err: unknown) {
      const execErr = err as { stderr?: string; stdout?: string; message?: string };
      const stderr = execErr.stderr || "";
      const stdout = execErr.stdout || "";
      const combined = (stdout + "\n" + stderr).trim();
      return {
        ok: false,
        output: combined || undefined,
        error: combined || execErr.message || "SSH command failed",
      };
    }
  }

  /** Test SSH connection to a host */
  testConnection(opts: { keyId: string; host: string }): { ok: boolean; error?: string } {
    const result = this.exec({ keyId: opts.keyId, host: opts.host, command: "echo ok", timeout: 15_000 });
    if (result.ok && result.output?.trim() === "ok") {
      return { ok: true };
    }
    return { ok: false, error: result.error || "Connection test failed" };
  }

  // ─── Session management ─────────────────────────────────────

  /** Create a session record */
  createSession(opts: {
    sshKeyId: string;
    host: string;
    initiatedBy: string;
  }): string {
    const id = nanoid();
    const now = new Date().toISOString();
    const db = getDb();
    db.insert(schema.sshSessions)
      .values({
        id,
        sshKeyId: opts.sshKeyId,
        host: opts.host,
        status: "active",
        startedAt: now,
        initiatedBy: opts.initiatedBy,
        createdAt: now,
      })
      .run();
    return id;
  }

  /** Update session status */
  updateSession(id: string, data: { status?: SshSessionStatus; completedAt?: string; terminalBuffer?: string }): void {
    const db = getDb();
    db.update(schema.sshSessions)
      .set(data)
      .where(eq(schema.sshSessions.id, id))
      .run();
  }

  /** List sessions */
  listSessions(limit = 20): SshSession[] {
    const db = getDb();
    const rows = db.select().from(schema.sshSessions)
      .orderBy(desc(schema.sshSessions.createdAt))
      .limit(limit)
      .all();

    return rows.map((r) => {
      // Look up the username from the key
      const key = this.get(r.sshKeyId);
      return {
        id: r.id,
        sshKeyId: r.sshKeyId,
        host: r.host,
        username: key?.username ?? "unknown",
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt ?? null,
        initiatedBy: r.initiatedBy,
      };
    });
  }

  /** Get a session by ID */
  getSession(id: string): (SshSession & { terminalBuffer?: string | null }) | null {
    const db = getDb();
    const row = db.select().from(schema.sshSessions).where(eq(schema.sshSessions.id, id)).get();
    if (!row) return null;
    const key = this.get(row.sshKeyId);
    return {
      id: row.id,
      sshKeyId: row.sshKeyId,
      host: row.host,
      username: key?.username ?? "unknown",
      status: row.status,
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? null,
      initiatedBy: row.initiatedBy,
      terminalBuffer: row.terminalBuffer,
    };
  }

  /** Delete a session record */
  deleteSession(id: string): boolean {
    const db = getDb();
    const result = db.delete(schema.sshSessions).where(eq(schema.sshSessions.id, id)).run();
    return result.changes > 0;
  }

  /** Get the internal key path (for PTY client use) */
  getKeyPath(id: string): string | null {
    const db = getDb();
    const row = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, id)).get();
    return row?.privateKeyPath ?? null;
  }
}
