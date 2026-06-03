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
import type { Account } from "@otterbot/shared";
// ssh2 is CommonJS; import the default and destructure (see integrations/ssh.ts).
import ssh2 from "ssh2";
import type { CredentialStore } from "../connections/credential-store.js";

const { utils } = ssh2;

/** The account type (in the unified `credentials` table) that backs an SSH key. */
const SSH_KEY_TYPE = "ssh-key";
/** Secret key under which the PEM private key is stored. */
const PRIVATE_KEY_SECRET = "SSH_PRIVATE_KEY";

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
    /** Unified account store; SSH keys are `ssh-key`-type accounts. */
    private readonly accounts: CredentialStore,
    /** Directory under which materialized private keys are cached on disk. */
    private readonly keysDir: string
  ) {}

  /** All keys, masked (no private material). */
  list(): MaskedSshKey[] {
    return this.accounts
      .list()
      .filter((a) => a.type === SSH_KEY_TYPE)
      .map((a) => this.toMasked(a));
  }

  get(id: string): MaskedSshKey | null {
    const a = this.row(id);
    return a ? this.toMasked(a) : null;
  }

  /** The OpenSSH public-key line for a key, or null if unknown. */
  publicKey(id: string): string | null {
    const cfg = this.row(id)?.config ?? null;
    return cfg && typeof cfg.publicKey === "string" ? cfg.publicKey : null;
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
    const a = this.row(id);
    if (!a) throw new Error(`SSH key "${id}" not found.`);
    const privateKey = this.accounts.secretsFor(id).get(PRIVATE_KEY_SECRET);
    const publicKey = typeof a.config.publicKey === "string" ? a.config.publicKey : "";
    if (!privateKey) throw new Error(`SSH key "${id}" has no stored private key.`);
    const dir = join(this.keysDir, id);
    mkdirSync(dir, { recursive: true });
    const privateKeyPath = join(dir, "id");
    const publicKeyPath = `${privateKeyPath}.pub`;
    // ssh/git refuse a world-readable key; `mode:` is umask-masked and not
    // reapplied to an existing file, so chmod explicitly afterwards.
    writeFileSync(privateKeyPath, ensureTrailingNewline(privateKey), { mode: 0o600 });
    chmodSync(privateKeyPath, 0o600);
    writeFileSync(publicKeyPath, ensureTrailingNewline(publicKey), { mode: 0o644 });
    return { privateKeyPath, publicKeyPath };
  }

  /**
   * Delete a key. Refuses while a git account references it unless `force`;
   * also removes any materialized on-disk copy.
   */
  delete(id: string, force = false): { deleted: boolean; referencedBy?: number } {
    const refs = this.accounts
      .list()
      .filter((a) => a.type === "git" && a.config?.sshKeyId === id);
    if (refs.length > 0 && !force) {
      return { deleted: false, referencedBy: refs.length };
    }
    const deleted = this.accounts.delete(id);
    const dir = join(this.keysDir, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return { deleted, referencedBy: refs.length || undefined };
  }

  // --- internals ------------------------------------------------------------

  private insert(
    label: string,
    publicKey: string,
    fingerprint: string,
    privateKey: string
  ): MaskedSshKey {
    const cred = this.accounts.create({
      type: SSH_KEY_TYPE,
      label: label || "ssh-key",
      config: { publicKey, fingerprint },
      secrets: { [PRIVATE_KEY_SECRET]: privateKey },
    });
    return this.toMasked(cred);
  }

  /** The backing `ssh-key` account, or null if the id is unknown / wrong type. */
  private row(id: string): Account | null {
    const a = this.accounts.get(id);
    return a && a.type === SSH_KEY_TYPE ? a : null;
  }

  private toMasked(a: Account): MaskedSshKey {
    const c = a.config ?? {};
    return {
      id: a.id,
      label: a.label,
      publicKey: typeof c.publicKey === "string" ? c.publicKey : "",
      fingerprint: typeof c.fingerprint === "string" ? c.fingerprint : "",
      createdAt: a.createdAt,
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
