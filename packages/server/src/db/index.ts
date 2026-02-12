import Database from "better-sqlite3-multiple-ciphers";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

function getDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/smoothbot.db";
  return url.replace(/^file:/, "");
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const dbPath = resolve(getDbPath());
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);

    // Encrypt the database
    const dbKey = process.env.SMOOTHBOT_DB_KEY;
    if (!dbKey) {
      throw new Error(
        "SMOOTHBOT_DB_KEY environment variable is required. Set it in your .env file.",
      );
    }
    sqlite.pragma(`key='${dbKey}'`);

    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

/** Create all tables if they don't exist */
export async function migrateDb() {
  const db = getDb();

  db.run(sql`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    registry_entry_id TEXT,
    role TEXT NOT NULL,
    parent_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT,
    temperature INTEGER,
    system_prompt TEXT,
    project_id TEXT,
    workspace_path TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT,
    to_agent_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    project_id TEXT,
    conversation_id TEXT,
    correlation_id TEXT,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add conversation_id to existing messages table
  try {
    db.run(sql`ALTER TABLE messages ADD COLUMN conversation_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add correlation_id to existing messages table
  try {
    db.run(sql`ALTER TABLE messages ADD COLUMN correlation_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS registry_entries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    default_model TEXT NOT NULL,
    default_provider TEXT NOT NULL,
    tools TEXT NOT NULL DEFAULT '[]',
    built_in INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL DEFAULT 'worker',
    cloned_from_id TEXT,
    created_at TEXT NOT NULL
  )`);

  // Idempotent migration: add model_pack_id to registry_entries
  try {
    db.run(sql`ALTER TABLE registry_entries ADD COLUMN model_pack_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add model_pack_id to agents
  try {
    db.run(sql`ALTER TABLE agents ADD COLUMN model_pack_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add gear_config to agents
  try {
    db.run(sql`ALTER TABLE agents ADD COLUMN gear_config TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add gear_config to registry_entries
  try {
    db.run(sql`ALTER TABLE registry_entries ADD COLUMN gear_config TEXT`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Seed built-in registry entries on every startup (dynamic import to avoid circular dep)
  const { seedBuiltIns } = await import("./seed.js");
  seedBuiltIns();
}

/** Reset the DB singleton (for testing) */
export function resetDb() {
  _db = null;
}

export { schema };
