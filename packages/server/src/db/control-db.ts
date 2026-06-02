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
    `CREATE TABLE IF NOT EXISTS global_secrets (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'broad'
    )`,
    `CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      credential_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS connection_assignments (
      connection_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, agent_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conn_assign_agent ON connection_assignments(agent_id)`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      repo_path TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      forge_account_id TEXT,
      forge_repo TEXT,
      fork_repo TEXT,
      forge_ssh_url TEXT,
      base_branch TEXT,
      monitor_issues INTEGER NOT NULL DEFAULT 0,
      triage_issues INTEGER NOT NULL DEFAULT 0,
      remote_e2e INTEGER NOT NULL DEFAULT 0,
      rules TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS forge_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      base_url TEXT NOT NULL,
      token TEXT NOT NULL,
      username TEXT NOT NULL DEFAULT '',
      git_transport TEXT NOT NULL DEFAULT 'https',
      committer_name TEXT NOT NULL DEFAULT '',
      committer_email TEXT NOT NULL DEFAULT '',
      sign_commits INTEGER NOT NULL DEFAULT 0,
      ssh_key_id TEXT,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ssh_keys (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      public_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL DEFAULT '',
      private_key TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'read',
      PRIMARY KEY (project_id, agent_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_project_members_agent ON project_members(agent_id)`,
    `CREATE TABLE IF NOT EXISTS project_team (
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, role)
    )`,
    `CREATE TABLE IF NOT EXISTS pipeline_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      current_stage TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      issue_number INTEGER,
      pr_branch TEXT,
      pr_number INTEGER,
      pr_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project ON pipeline_runs(project_id)`,
    `CREATE TABLE IF NOT EXISTS pipeline_stage_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      report TEXT NOT NULL DEFAULT '',
      attempt INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pipeline_stage_run ON pipeline_stage_results(run_id, id)`,
    `CREATE TABLE IF NOT EXISTS issue_triage (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      plan TEXT NOT NULL DEFAULT '',
      last_comment_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_issue_triage_issue ON issue_triage(project_id, issue_number)`,
  ];
  for (const s of stmts) sqlite.exec(s);

  // Additive column migrations for tables that predate the column. CREATE TABLE
  // IF NOT EXISTS never alters an existing table, so add new columns explicitly;
  // swallow the "duplicate column name" error when the column is already there.
  addColumnIfMissing(sqlite, "forge_accounts", "ssh_key_id", "TEXT");
}

/** Add a column to an existing table, ignoring the error if it already exists. */
function addColumnIfMissing(
  sqlite: Database.Database,
  table: string,
  column: string,
  type: string
) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
