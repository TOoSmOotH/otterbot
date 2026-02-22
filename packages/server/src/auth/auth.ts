import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq, lt } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";

const scryptAsync = promisify(scrypt);

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(passphrase, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassphrase(
  passphrase: string,
  stored: string,
): Promise<boolean> {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = (await scryptAsync(passphrase, salt, 64)) as Buffer;
  const storedBuffer = Buffer.from(key, "hex");
  if (derived.length !== storedBuffer.length) return false;
  return timingSafeEqual(derived, storedBuffer);
}

// ---------------------------------------------------------------------------
// Session management (persistent, DB-backed)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(): { token: string; maxAge: number } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const db = getDb();
  db.insert(schema.sessions)
    .values({ token, expiresAt, createdAt: new Date().toISOString() })
    .run();
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const db = getDb();
  const row = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.token, token))
    .get();
  if (!row) return false;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.delete(schema.sessions).where(eq(schema.sessions.token, token)).run();
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  const db = getDb();
  db.delete(schema.sessions).where(eq(schema.sessions.token, token)).run();
}

/**
 * Rotate a session: destroy the old token and create a new one.
 * Used during login to prevent session fixation.
 */
export function rotateSession(oldToken?: string): { token: string; maxAge: number } {
  if (oldToken) {
    destroySession(oldToken);
  }
  return createSession();
}

/** Remove expired sessions from the DB */
function cleanupExpiredSessions(): void {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    db.delete(schema.sessions)
      .where(lt(schema.sessions.expiresAt, now))
      .run();
  } catch {
    // DB may not be initialized yet during startup; ignore
  }
}

// Cleanup expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Config table helpers
// ---------------------------------------------------------------------------

export function getConfig(key: string): string | undefined {
  const db = getDb();
  const row = db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, key))
    .get();
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.insert(schema.config)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.config.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
}

export function deleteConfig(key: string): void {
  const db = getDb();
  db.delete(schema.config).where(eq(schema.config.key, key)).run();
}

// ---------------------------------------------------------------------------
// Setup status
// ---------------------------------------------------------------------------

export function isSetupComplete(): boolean {
  return (
    getConfig("passphrase_hash") !== undefined &&
    getConfig("coo_provider") !== undefined &&
    getConfig("coo_model") !== undefined
  );
}

export function isPassphraseSet(): boolean {
  return getConfig("passphrase_hash") !== undefined;
}

export function isPassphraseTemporary(): boolean {
  return getConfig("passphrase_is_temporary") === "true";
}
