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
  googleChatUserId: string;
  googleChatUsername: string;
  createdAt: string;
}

export interface PairedUser {
  googleChatUserId: string;
  googleChatUsername: string;
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
 * Generate a pairing code for a Google Chat user.
 * Only one active code per user — generating a new one deletes the old.
 */
export function generatePairingCode(googleChatUserId: string, googleChatUsername: string): string {
  // Remove any existing code for this user
  const existing = getConfigsByPrefix("googlechat:pairing:");
  for (const row of existing) {
    try {
      const data = JSON.parse(row.value) as PendingPairing;
      if (data.googleChatUserId === googleChatUserId) {
        deleteConfig(row.key);
      }
    } catch { /* ignore malformed */ }
  }

  const code = generateCode();
  const data: PendingPairing = {
    code,
    googleChatUserId,
    googleChatUsername,
    createdAt: new Date().toISOString(),
  };
  setConfig(`googlechat:pairing:${code}`, JSON.stringify(data));
  return code;
}

/**
 * Check whether a Google Chat user is paired.
 */
export function isPaired(googleChatUserId: string): boolean {
  return !!getConfig(`googlechat:paired:${googleChatUserId}`);
}

/**
 * Get paired user info.
 */
export function getPairedUser(googleChatUserId: string): PairedUser | null {
  const raw = getConfig(`googlechat:paired:${googleChatUserId}`);
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
  const raw = getConfig(`googlechat:pairing:${code}`);
  if (!raw) return null;

  let pending: PendingPairing;
  try {
    pending = JSON.parse(raw) as PendingPairing;
  } catch {
    return null;
  }

  // Check expiry
  if (Date.now() - new Date(pending.createdAt).getTime() > PAIRING_TTL_MS) {
    deleteConfig(`googlechat:pairing:${code}`);
    return null;
  }

  const paired: PairedUser = {
    googleChatUserId: pending.googleChatUserId,
    googleChatUsername: pending.googleChatUsername,
    pairedAt: new Date().toISOString(),
  };

  setConfig(`googlechat:paired:${pending.googleChatUserId}`, JSON.stringify(paired));
  deleteConfig(`googlechat:pairing:${code}`);
  return paired;
}

/**
 * Reject (delete) a pending pairing code.
 */
export function rejectPairing(code: string): boolean {
  const raw = getConfig(`googlechat:pairing:${code}`);
  if (!raw) return false;
  deleteConfig(`googlechat:pairing:${code}`);
  return true;
}

/**
 * Revoke a paired user's access.
 */
export function revokePairing(googleChatUserId: string): boolean {
  const raw = getConfig(`googlechat:paired:${googleChatUserId}`);
  if (!raw) return false;
  deleteConfig(`googlechat:paired:${googleChatUserId}`);
  return true;
}

/**
 * List all paired users.
 */
export function listPairedUsers(): PairedUser[] {
  const rows = getConfigsByPrefix("googlechat:paired:");
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
  const rows = getConfigsByPrefix("googlechat:pairing:");
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
