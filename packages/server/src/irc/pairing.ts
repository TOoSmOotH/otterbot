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
  ircUserId: string;
  ircUsername: string;
  createdAt: string;
}

export interface PairedUser {
  ircUserId: string;
  ircUsername: string;
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

/**
 * Generate a pairing code for an IRC user.
 * Only one active code per user — generating a new one deletes the old.
 */
export function generatePairingCode(ircUserId: string, ircUsername: string): string {
  // Remove any existing code for this user
  const existing = getConfigsByPrefix("irc:pairing:");
  for (const row of existing) {
    try {
      const data = JSON.parse(row.value) as PendingPairing;
      if (data.ircUserId === ircUserId) {
        deleteConfig(row.key);
      }
    } catch { /* ignore malformed */ }
  }

  const code = generateCode();
  const data: PendingPairing = {
    code,
    ircUserId,
    ircUsername,
    createdAt: new Date().toISOString(),
  };
  setConfig(`irc:pairing:${code}`, JSON.stringify(data));
  return code;
}

/**
 * Check whether an IRC user is paired.
 */
export function isPaired(ircUserId: string): boolean {
  return !!getConfig(`irc:paired:${ircUserId}`);
}

/**
 * Get paired user info.
 */
export function getPairedUser(ircUserId: string): PairedUser | null {
  const raw = getConfig(`irc:paired:${ircUserId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PairedUser;
  } catch {
    return null;
  }
}

/**
 * Approve a pending pairing by code.
 * Returns the paired user info, or null if the code is invalid/expired.
 */
export function approvePairing(code: string): PairedUser | null {
  const raw = getConfig(`irc:pairing:${code}`);
  if (!raw) return null;

  let pending: PendingPairing;
  try {
    pending = JSON.parse(raw) as PendingPairing;
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() - new Date(pending.createdAt).getTime() > PAIRING_TTL_MS) {
    deleteConfig(`irc:pairing:${code}`);
    return null;
  }

  const paired: PairedUser = {
    ircUserId: pending.ircUserId,
    ircUsername: pending.ircUsername,
    pairedAt: new Date().toISOString(),
  };

  setConfig(`irc:paired:${pending.ircUserId}`, JSON.stringify(paired));
  deleteConfig(`irc:pairing:${code}`);
  return paired;
}

/**
 * Reject (delete) a pending pairing code.
 */
export function rejectPairing(code: string): boolean {
  const raw = getConfig(`irc:pairing:${code}`);
  if (!raw) return false;
  deleteConfig(`irc:pairing:${code}`);
  return true;
}

/**
 * Revoke a paired user's access.
 */
export function revokePairing(ircUserId: string): boolean {
  const raw = getConfig(`irc:paired:${ircUserId}`);
  if (!raw) return false;
  deleteConfig(`irc:paired:${ircUserId}`);
  return true;
}

/**
 * List all paired users.
 */
export function listPairedUsers(): PairedUser[] {
  const rows = getConfigsByPrefix("irc:paired:");
  const users: PairedUser[] = [];
  for (const row of rows) {
    try {
      users.push(JSON.parse(row.value) as PairedUser);
    } catch { /* ignore malformed */ }
  }
  return users;
}

/**
 * List all pending (non-expired) pairing codes.
 */
export function listPendingPairings(): PendingPairing[] {
  const rows = getConfigsByPrefix("irc:pairing:");
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
