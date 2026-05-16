import type Database from "better-sqlite3-multiple-ciphers";

/**
 * Apply the database encryption key, if one is configured. Must be called on a
 * fresh connection before any other statement. When no key is set the database
 * is unencrypted (intended for local dev and tests only).
 */
export function applyDbKey(
  sqlite: Database.Database,
  key: string | null | undefined
): void {
  if (!key) return;
  sqlite.pragma(`key='${key.replace(/'/g, "''")}'`);
}
