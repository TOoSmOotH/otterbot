/**
 * Versioned schema migration runner for module knowledge databases.
 */

import type Database from "better-sqlite3-multiple-ciphers";
import type { ModuleMigration } from "@otterbot/shared";

export interface MigrationResult {
  applied: number;
  currentVersion: number;
}

/** Ensure the _migrations tracking table exists. */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

/** Get the highest applied migration version, or 0 if none. */
function getCurrentVersion(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(version) as v FROM _migrations").get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * Run pending migrations in version order.
 * Each migration is wrapped in a transaction; on failure the transaction
 * is rolled back and the error is re-thrown.
 */
export function runMigrations(
  db: Database.Database,
  migrations: ModuleMigration[],
  moduleId: string,
): MigrationResult {
  ensureMigrationsTable(db);

  const currentVersion = getCurrentVersion(db);
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  let applied = 0;

  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO _migrations (version, description, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.description, new Date().toISOString());
    });

    try {
      run();
      applied++;
      console.log(
        `[module:${moduleId}] Applied migration v${migration.version}: ${migration.description}`,
      );
    } catch (err) {
      console.error(
        `[module:${moduleId}] Migration v${migration.version} failed:`,
        err,
      );
      throw err;
    }
  }

  return {
    applied,
    currentVersion: getCurrentVersion(db),
  };
}
