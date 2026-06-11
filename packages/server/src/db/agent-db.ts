import Database from "better-sqlite3-multiple-ciphers";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";
import * as schema from "./schema.js";
import { applyDbKey } from "./crypto.js";

export { schema };

export type AgentDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/** A single agent's isolated SQLite database (memories, skills, conversations, vectors). */
export interface AgentDb {
  sqlite: Database.Database;
  db: AgentDrizzle;
  /** Drop and recreate the vec0 table at the given embedding dimension. */
  recreateVecTable(dim: number): void;
  close(): void;
}

/**
 * Open (creating if needed) an agent's isolated database. Each agent profile
 * gets its own `agent.db` file — this is required because `sqlite-vec`'s
 * `vec_memories` table has a fixed embedding dimension per database, and
 * different agents may pick embedding models with different dimensions.
 */
export function openAgentDb(path: string, key?: string | null): AgentDb {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  applyDbKey(sqlite, key);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  ensureAgentTables(sqlite);
  ensureFts(sqlite);
  ensureVec(sqlite);
  ensureCodeIndex(sqlite);
  return {
    sqlite,
    db,
    recreateVecTable: (dim: number) => recreateVecTable(sqlite, dim),
    close: () => sqlite.close(),
  };
}

/**
 * Minimal schema push without drizzle-kit: creates tables if missing.
 * Fine for a single-user SQLite deployment.
 */
function ensureAgentTables(sqlite: Database.Database) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      closed_at TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_compacted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      attachments TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS conversation_recaps (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      recap TEXT NOT NULL,
      key_points TEXT NOT NULL DEFAULT '[]',
      covered_through_message_id TEXT NOT NULL,
      covered_message_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_recaps_conversation ON conversation_recaps(conversation_id)`,
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
      entity_refs TEXT NOT NULL DEFAULT '[]',
      temporal_marker TEXT,
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
      mcp_servers TEXT NOT NULL DEFAULT '[]',
      credential_keys TEXT NOT NULL DEFAULT '[]',
      config_schema TEXT,
      body TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'authored',
      scan_status TEXT NOT NULL DEFAULT 'unscanned',
      scan_findings TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS vec_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      from_agent_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      correlation_id TEXT,
      body TEXT NOT NULL,
      payload TEXT,
      handled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_handled ON inbox(handled, created_at)`,
  ];
  for (const s of stmts) sqlite.exec(s);
}

/**
 * FTS5 virtual table for cross-session recall. One table covers
 * memories + session_summaries + skills; rows are kept in sync by the
 * service layer, not triggers.
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

/**
 * Tables for the optional `code-index` capability: a per-agent index over the
 * repos of the project the agent belongs to. Kept separate from `content_fts`
 * so indexed code never leaks into the agent's memory recall / system prompt.
 * The `vec_code` vec0 table is created lazily (it needs the embedding
 * dimension) by `CodeIndexService`, mirroring how `vec_memories` is deferred.
 */
function ensureCodeIndex(sqlite: Database.Database) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS code_files (
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (repo, path)
    )`,
    `CREATE TABLE IF NOT EXISTS code_chunks (
      id TEXT PRIMARY KEY,
      repo TEXT NOT NULL,
      path TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      content TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_code_chunks_file ON code_chunks(repo, path)`,
    `CREATE TABLE IF NOT EXISTS code_index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ];
  for (const s of stmts) sqlite.exec(s);
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
      chunk_id UNINDEXED,
      repo UNINDEXED,
      path,
      body,
      tokenize = 'porter unicode61'
    )
  `);
}

/** Load the sqlite-vec extension. vec0 table creation is deferred until a dimension is known. */
function ensureVec(sqlite: Database.Database) {
  try {
    sqliteVec.load(sqlite);
  } catch (err) {
    console.warn(
      "[db] sqlite-vec extension load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Drop and recreate vec_memories with the given dimension. Uses an explicit
 * TEXT primary key (`memory_id`) so memory ids (nanoids) can key the table —
 * vec0's implicit rowid only accepts integers.
 */
export function recreateVecTable(sqlite: Database.Database, dim: number) {
  sqlite.exec(`DROP TABLE IF EXISTS vec_memories`);
  sqlite.exec(
    `CREATE VIRTUAL TABLE vec_memories USING vec0(memory_id TEXT PRIMARY KEY, embedding float[${dim}])`
  );
}
