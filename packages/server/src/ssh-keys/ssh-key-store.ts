/**
 * Named, reusable SSH keys the user generates or imports in Settings →
 * Credentials. Standalone (not tied to one forge account) so a git account can
 * reference one by id for git-over-SSH clone/push + commit signing.
 *
 * The private key lives encrypted at rest in the control database (SQLCipher via
 * `OTTERBOT_DB_KEY`) and is never returned by the API. At git time it is
 * materialized to a 0600 file under `keysDir` (alongside a 0644 `.pub`) so git's
 * `GIT_SSH_COMMAND -i <path>` can use it — mirroring the forge-account keys.
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
// ssh2 is CommonJS; import the default and destructure (see integrations/ssh.ts).
import ssh2 from "ssh2";
import { controlSchema, type ControlDb } from "../db/control-db.js";

const { utils } = ssh2;

/** An SSH key as returned to the API/UI — never includes the private key. */
export interface MaskedSshKey {
  id: string;
  label: string;
  /** OpenSSH public-key line (safe to display — for copying to the forge). */
  publicKey: string;
  /** SHA256:… fingerprint, matching what GitHub displays. */
  fingerprint: string;
  createdAt: string;
}

/** On-disk paths to a materialized key (for git's GIT_SSH_COMMAND / signing). */
export interface MaterializedKey {
  /** 0600 private key file. */
  privateKeyPath: string;
  /** 0644 public key file (used for SSH commit signing). */
  publicKeyPath: string;
}

export class SshKeyStore {
  constructor(
    private readonly control: ControlDb,
    /** Directory under which materialized private keys are cached on disk. */
    private readonly keysDir: string
  ) {}

  /** All keys, masked (no private material). */
  list(): MaskedSshKey[] {
    return this.control.db
      .select()
      .from(controlSchema.sshKeys)
      .all()
      .map((r) => this.toMasked(r));
  }

  get(id: string): MaskedSshKey | null {
    const r = this.row(id);
    return r ? this.toMasked(r) : null;
  }

  /** The OpenSSH public-key line for a key, or null if unknown. */
  publicKey(id: string): string | null {
    return this.row(id)?.publicKey ?? null;
  }

  /** Generate a new ed25519 keypair and persist it; returns the masked record. */
  generate(label: string): MaskedSshKey {
    const pair = utils.generateKeyPairSync("ed25519");
    // `pair.public` is already a full OpenSSH line; derive a matching fingerprint.
    const fingerprint = this.fingerprintOf(pair.private);
    return this.insert(label, pair.public.trim(), fingerprint, pair.private);
  }

  /**
   * Import an existing private key (PEM/OpenSSH). Derives the public line and
   * fingerprint without writing the private key to disk. Throws on an invalid or
   * passphrase-protected key.
   */
  import(label: string, privateKeyPem: string): MaskedSshKey {
    const pem = privateKeyPem.trim();
    const parsed = utils.parseKey(pem);
    if (parsed instanceof Error) {
      throw new Error(`Could not parse the private key: ${parsed.message}`);
    }
    const publicKey = publicLine(parsed);
    const fingerprint = fingerprintFromParsed(parsed);
    return this.insert(label, publicKey, fingerprint, pem);
  }

  /**
   * Write the private key to a cached 0600 file (and a 0644 `.pub`) under
   * `keysDir`, returning their paths for git. Idempotent — rewrites each call so
   * the on-disk copy always matches the stored key. Throws if the key is gone.
   */
  materialize(id: string): MaterializedKey {
    const r = this.row(id);
    if (!r) throw new Error(`SSH key "${id}" not found.`);
    const dir = join(this.keysDir, id);
    mkdirSync(dir, { recursive: true });
    const privateKeyPath = join(dir, "id");
    const publicKeyPath = `${privateKeyPath}.pub`;
    // ssh/git refuse a world-readable key; `mode:` is umask-masked and not
    // reapplied to an existing file, so chmod explicitly afterwards.
    writeFileSync(privateKeyPath, ensureTrailingNewline(r.privateKey), { mode: 0o600 });
    chmodSync(privateKeyPath, 0o600);
    writeFileSync(publicKeyPath, ensureTrailingNewline(r.publicKey), { mode: 0o644 });
    return { privateKeyPath, publicKeyPath };
  }

  /**
   * Delete a key. Refuses while a forge account references it unless `force`;
   * also removes any materialized on-disk copy.
   */
  delete(id: string, force = false): { deleted: boolean; referencedBy?: number } {
    const refs = this.control.db
      .select({ id: controlSchema.forgeAccounts.id })
      .from(controlSchema.forgeAccounts)
      .where(eq(controlSchema.forgeAccounts.sshKeyId, id))
      .all();
    if (refs.length > 0 && !force) {
      return { deleted: false, referencedBy: refs.length };
    }
    const res = this.control.db
      .delete(controlSchema.sshKeys)
      .where(eq(controlSchema.sshKeys.id, id))
      .run();
    const dir = join(this.keysDir, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return { deleted: res.changes > 0, referencedBy: refs.length || undefined };
  }

  // --- internals ------------------------------------------------------------

  private insert(
    label: string,
    publicKey: string,
    fingerprint: string,
    privateKey: string
  ): MaskedSshKey {
    const id = nanoid();
    const now = new Date().toISOString();
    this.control.db
      .insert(controlSchema.sshKeys)
      .values({ id, label: label || "ssh-key", publicKey, fingerprint, privateKey, createdAt: now })
      .run();
    return this.get(id)!;
  }

  private row(id: string) {
    return (
      this.control.db
        .select()
        .from(controlSchema.sshKeys)
        .where(eq(controlSchema.sshKeys.id, id))
        .get() ?? null
    );
  }

  private toMasked(r: typeof controlSchema.sshKeys.$inferSelect): MaskedSshKey {
    return {
      id: r.id,
      label: r.label,
      publicKey: r.publicKey,
      fingerprint: r.fingerprint,
      createdAt: r.createdAt,
    };
  }

  /** Fingerprint a private key by parsing it (matches the import path exactly). */
  private fingerprintOf(privateKeyPem: string): string {
    const parsed = utils.parseKey(privateKeyPem);
    if (parsed instanceof Error) return "";
    return fingerprintFromParsed(parsed);
  }
}

/**
 * Build the OpenSSH `type base64 [comment]` public-key line. `getPublicSSH()`
 * returns the raw binary wire blob, not text, so assemble the line ourselves.
 */
function publicLine(parsed: import("ssh2").ParsedKey): string {
  const blob = parsed.getPublicSSH().toString("base64");
  const comment = parsed.comment ? ` ${parsed.comment}` : "";
  return `${parsed.type} ${blob}${comment}`;
}

/** `SHA256:<base64-no-padding>` over the public wire blob — matches GitHub. */
function fingerprintFromParsed(parsed: import("ssh2").ParsedKey): string {
  const hash = createHash("sha256").update(parsed.getPublicSSH()).digest("base64");
  return `SHA256:${hash.replace(/=+$/, "")}`;
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
