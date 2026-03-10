import { randomBytes } from "node:crypto";
import { like } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCode(): string {
  return randomBytes(3).toString("hex").toUpperCase(); // 6-char hex
}

const PAIRING_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PendingPairing {
  code: string;
  mastodonId: string;
  mastodonAcct: string;
  createdAt: string;
}

export interface PairedUser {
  mastodonId: string;
  mastodonAcct: string;
  pairedAt: string;
}

// ---------------------------------------------------------------------------
// Config-prefix query helper
// ---------------------------------------------------------------------------

function getConfigsByPrefix(prefix: string): Array<{ key: string; value: string }> {
  const db = getDb();
  return db
    .select({ key: schema.config.key, value: schema.config.value })
    .from(schema.config)
    .where(like(schema.config.key, `${prefix}%`))
    .all();
}

// ---------------------------------------------------------------------------
// Pairing code management
// ---------------------------------------------------------------------------

export function generatePairingCode(mastodonId: string, mastodonAcct: string): string {
  // Remove any existing code for this user
  const existing = getConfigsByPrefix("mastodon:pairing:");
  for (const row of existing) {
    try {
      const data = JSON.parse(row.value) as PendingPairing;
      if (data.mastodonId === mastodonId) {
        deleteConfig(row.key);
      }
    } catch { /* ignore malformed */ }
  }

  const code = generateCode();
  const data: PendingPairing = {
    code,
    mastodonId,
    mastodonAcct,
    createdAt: new Date().toISOString(),
  };
  setConfig(`mastodon:pairing:${code}`, JSON.stringify(data));
  return code;
}

export function isPaired(mastodonId: string): boolean {
  return !!getConfig(`mastodon:paired:${mastodonId}`);
}

export function getPairedUser(mastodonId: string): PairedUser | null {
  const raw = getConfig(`mastodon:paired:${mastodonId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PairedUser;
  } catch {
    return null;
  }
}

export function approvePairing(code: string): PairedUser | null {
  const raw = getConfig(`mastodon:pairing:${code}`);
  if (!raw) return null;

  let pending: PendingPairing;
  try {
    pending = JSON.parse(raw) as PendingPairing;
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() - new Date(pending.createdAt).getTime() > PAIRING_TTL_MS) {
    deleteConfig(`mastodon:pairing:${code}`);
    return null;
  }

  const paired: PairedUser = {
    mastodonId: pending.mastodonId,
    mastodonAcct: pending.mastodonAcct,
    pairedAt: new Date().toISOString(),
  };

  setConfig(`mastodon:paired:${pending.mastodonId}`, JSON.stringify(paired));
  deleteConfig(`mastodon:pairing:${code}`);
  return paired;
}

export function rejectPairing(code: string): boolean {
  const raw = getConfig(`mastodon:pairing:${code}`);
  if (!raw) return false;
  deleteConfig(`mastodon:pairing:${code}`);
  return true;
}

export function revokePairing(mastodonId: string): boolean {
  const raw = getConfig(`mastodon:paired:${mastodonId}`);
  if (!raw) return false;
  deleteConfig(`mastodon:paired:${mastodonId}`);
  return true;
}

export function listPairedUsers(): PairedUser[] {
  const rows = getConfigsByPrefix("mastodon:paired:");
  const users: PairedUser[] = [];
  for (const row of rows) {
    try {
      users.push(JSON.parse(row.value) as PairedUser);
    } catch { /* ignore malformed */ }
  }
  return users;
}

export function listPendingPairings(): PendingPairing[] {
  const rows = getConfigsByPrefix("mastodon:pairing:");
  const now = Date.now();
  const pending: PendingPairing[] = [];
  for (const row of rows) {
    try {
      const data = JSON.parse(row.value) as PendingPairing;
      if (now - new Date(data.createdAt).getTime() <= PAIRING_TTL_MS) {
        pending.push(data);
      } else {
        // Clean up expired
        deleteConfig(row.key);
      }
    } catch { /* ignore malformed */ }
  }
  return pending;
}
