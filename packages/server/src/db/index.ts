import Database from "better-sqlite3-multiple-ciphers";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { getConfig } from "../config.js";
import * as schema from "./schema.js";

export { schema };

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function dbPath(): string {
  const url = process.env.DATABASE_URL ?? `file:${resolve(getConfig().dataDir, "otterbot.db")}`;
  return url.replace(/^file:/, "");
}

export function getRawSqlite(): Database.Database {
  getDb();
  if (!_sqlite) throw new Error("Database not initialized");
  return _sqlite;
}

export function getDb() {
  if (!_db) {
    const path = resolve(dbPath());
    mkdirSync(dirname(path), { recursive: true });
    _sqlite = new Database(path);
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");
    _db = drizzle(_sqlite, { schema });
    ensureTables(_sqlite);
    ensureFts(_sqlite);
  }
  return _db;
}

/**
 * Minimal schema push without drizzle-kit: creates tables if missing.
 * Fine for a single-user SQLite deployment; for richer migrations we'd
 * switch to drizzle-kit migrate.
 */
function ensureTables(sqlite: Database.Database) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      key_points TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'general',
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      importance INTEGER NOT NULL DEFAULT 5,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '1.0.0',
      author TEXT NOT NULL DEFAULT '',
      tools TEXT NOT NULL DEFAULT '[]',
      capabilities TEXT NOT NULL DEFAULT '[]',
      parameters TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'authored',
      scan_status TEXT NOT NULL DEFAULT 'unscanned',
      scan_findings TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 0,
      file_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_profile (
      id TEXT PRIMARY KEY DEFAULT 'singleton',
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY,
      ref_kind TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      vector TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(ref_kind, ref_id)`,
  ];
  for (const s of stmts) sqlite.exec(s);
}

/**
 * FTS5 virtual table for cross-session recall.
 * One table covers memories + session_summaries + skills; rows are
 * kept in sync by service layer, not triggers, so we can change the
 * source tables freely.
 */
function ensureFts(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
      kind UNINDEXED,
      ref_id UNINDEXED,
      title,
      body,
      tags,
      tokenize = 'porter unicode61'
    )
  `);
}
