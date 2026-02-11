import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
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
// Session management (in-memory)
// ---------------------------------------------------------------------------

const sessions = new Map<string, number>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function createSession(): { token: string; maxAge: number } {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

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

// ---------------------------------------------------------------------------
// Available LLM providers (static list — keys are stored in DB, not env)
// ---------------------------------------------------------------------------

export function getAvailableProviders(): Array<{ id: string; name: string }> {
  return [
    { id: "anthropic", name: "Anthropic" },
    { id: "openai", name: "OpenAI" },
    { id: "ollama", name: "Ollama" },
    { id: "openai-compatible", name: "OpenAI-Compatible" },
  ];
}
