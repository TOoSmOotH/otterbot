import Database from "better-sqlite3-multiple-ciphers";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";
import { applyDbKey } from "./crypto.js";

/**
 * The shared, instance-wide code-reference database. Holds file chunks from
 * every configured reference repo plus their FTS5 + sqlite-vec indexes. Unlike
 * per-agent `agent.db`, there is exactly one of these for the whole instance —
 * the semantic index uses the single instance default embedding model, so the
 * vec0 dimension is fixed per database just like an agent's.
 */
export interface CodeReferenceDb {
  sqlite: Database.Database;
  /** Drop and recreate the vec0 table at the given embedding dimension. */
  recreateVecTable(dim: number): void;
  close(): void;
}

/** Open (creating if needed) the shared code-reference database. */
export function openCodeReferenceDb(path: string, key?: string | null): CodeReferenceDb {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  applyDbKey(sqlite, key);
  sqlite.pragma("journal_mode = WAL");
  ensureTables(sqlite);
  ensureFts(sqlite);
  ensureVec(sqlite);
  return {
    sqlite,
    recreateVecTable: (dim: number) => recreateVecTable(sqlite, dim),
    close: () => sqlite.close(),
  };
}

function ensureTables(sqlite: Database.Database) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS code_chunks (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_code_chunks_repo ON code_chunks(repo_id)`,
    `CREATE INDEX IF NOT EXISTS idx_code_chunks_repo_path ON code_chunks(repo_id, path)`,
    `CREATE TABLE IF NOT EXISTS vec_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ];
  for (const s of stmts) sqlite.exec(s);
}

/**
 * FTS5 virtual table over chunk bodies. Rows are kept in sync by the service
 * layer (no triggers), mirroring the memory `content_fts` approach.
 */
function ensureFts(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      repo_id UNINDEXED,
      chunk_id UNINDEXED,
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
      "[code-ref-db] sqlite-vec extension load failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Drop and recreate `vec_chunks` with the given dimension. Uses an explicit
 * TEXT primary key (`chunk_id`) so nanoid chunk ids can key the table.
 */
export function recreateVecTable(sqlite: Database.Database, dim: number) {
  sqlite.exec(`DROP TABLE IF EXISTS vec_chunks`);
  sqlite.exec(
    `CREATE VIRTUAL TABLE vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${dim}])`
  );
}
