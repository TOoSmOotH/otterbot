import Database from "better-sqlite3-multiple-ciphers";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import * as controlSchema from "./control-schema.js";
import { applyDbKey } from "./crypto.js";

export { controlSchema };

export type ControlDrizzle = ReturnType<typeof drizzle<typeof controlSchema>>;

/** The shared control-plane database (agent registry, bus log, spawn tree, schedules). */
export interface ControlDb {
  sqlite: Database.Database;
  db: ControlDrizzle;
  close(): void;
}

export function openControlDb(path: string, key?: string | null): ControlDb {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  applyDbKey(sqlite, key);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema: controlSchema });
  ensureControlTables(sqlite);
  return { sqlite, db, close: () => sqlite.close() };
}

function ensureControlTables(sqlite: Database.Database) {
  const stmts: string[] = [
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'agent',
      profile_dir TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      parent_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS bus_messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      from_agent_id TEXT NOT NULL,
      to_agent_id TEXT,
      thread_id TEXT NOT NULL,
      correlation_id TEXT,
      root_spawn_id TEXT,
      body TEXT NOT NULL DEFAULT '',
      payload TEXT,
      status TEXT,
      transport TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bus_thread ON bus_messages(thread_id, seq)`,
    `CREATE INDEX IF NOT EXISTS idx_bus_root ON bus_messages(root_spawn_id, seq)`,
    `CREATE TABLE IF NOT EXISTS subagent_tasks (
      id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL,
      parent_task_id TEXT,
      parent_agent_id TEXT NOT NULL,
      subagent_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      result_summary TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subagent_root ON subagent_tasks(root_id)`,
    `CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      cron TEXT NOT NULL,
      prompt TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS agent_secrets (
      agent_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'broad',
      PRIMARY KEY (agent_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ];
  for (const s of stmts) sqlite.exec(s);

  // Migration: credentials grew a scope column. Default 'broad' preserves the
  // pre-existing behaviour (every key dumped into the shell env) until the
  // startup migration re-tags known keys.
  const secretCols = new Set(
    (sqlite.prepare(`PRAGMA table_info(agent_secrets)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
  if (!secretCols.has("scope")) {
    sqlite.exec(`ALTER TABLE agent_secrets ADD COLUMN scope TEXT NOT NULL DEFAULT 'broad'`);
  }
}
