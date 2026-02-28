import Database from "better-sqlite3-multiple-ciphers";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql, eq } from "drizzle-orm";
import * as schema from "./schema.js";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export function getDbPath(): string {
  const url = process.env.DATABASE_URL ?? "file:./data/otterbot.db";
  return url.replace(/^file:/, "");
}

let _sqlite: Database.Database | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const dbPath = resolve(getDbPath());
    mkdirSync(dirname(dbPath), { recursive: true });
    _sqlite = new Database(dbPath);

    // Encrypt the database
    const dbKey = process.env.OTTERBOT_DB_KEY;
    if (!dbKey) {
      throw new Error(
        "OTTERBOT_DB_KEY environment variable is required. Set it in your .env file.",
      );
    }
    _sqlite.pragma(`key='${dbKey.replace(/'/g, "''")}'`);

    _sqlite.pragma("journal_mode = WAL");
    _sqlite.pragma("foreign_keys = ON");
    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export async function backupDatabase(destination: string): Promise<void> {
  // Ensure DB is initialized
  getDb();
  if (!_sqlite) throw new Error("Database not initialized");
  _sqlite.prepare("VACUUM INTO ?").run(destination);
}

export function closeDatabase() {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}

export function verifyDatabase(path: string, key: string): boolean {
  try {
    const testDb = new Database(path, { readonly: true });
    testDb.pragma(`key='${key.replace(/'/g, "''")}'`);
    // Try to read from the master table to verify decryption works
    testDb.prepare("SELECT count(*) FROM sqlite_master").get();
    testDb.close();
    return true;
  } catch (err) {
    console.error("Database verification failed:", err);
    return false;
  }
}

/** Create all tables if they don't exist */
export async function migrateDb() {
  const db = getDb();

  db.run(sql`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
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
    project_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add project_id to existing conversations table
  try {
    db.run(sql`ALTER TABLE conversations ADD COLUMN project_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

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
    prompt_addendum TEXT,
    cloned_from_id TEXT,
    created_at TEXT NOT NULL
  )`);

  // Idempotent migration: add name to agents
  try {
    db.run(sql`ALTER TABLE agents ADD COLUMN name TEXT`);
  } catch {
    // Column already exists — ignore
  }

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

  // Idempotent migration: add prompt_addendum to registry_entries
  try {
    db.run(sql`ALTER TABLE registry_entries ADD COLUMN prompt_addendum TEXT`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    charter TEXT,
    charter_status TEXT DEFAULT 'gathering',
    created_at TEXT NOT NULL
  )`);

  // Idempotent migration: add charter fields to existing projects table
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN charter TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN charter_status TEXT DEFAULT 'gathering'`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add GitHub fields to projects
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN github_repo TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN github_branch TEXT`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN github_issue_monitor INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }
  try {
    db.run(sql`ALTER TABLE projects ADD COLUMN rules TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS kanban_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    column TEXT NOT NULL DEFAULT 'backlog',
    position INTEGER NOT NULL DEFAULT 0,
    assignee_agent_id TEXT,
    created_by TEXT,
    labels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add blocked_by to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN blocked_by TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add completion_report to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN completion_report TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add retry_count to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add spawn_count to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN spawn_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add pr_number to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN pr_number INTEGER`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add pr_branch to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN pr_branch TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add pipeline_stage to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN pipeline_stage TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add pipeline_attempt to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN pipeline_attempt INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add pipeline_stages to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN pipeline_stages TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add task_number to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN task_number INTEGER`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add stage_reports to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN stage_reports TEXT NOT NULL DEFAULT '{}'`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add last_kickback_source to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN last_kickback_source TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add spawn_retry_count to kanban_tasks
  try {
    db.run(sql`ALTER TABLE kanban_tasks ADD COLUMN spawn_retry_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — ignore
  }

  // Backfill task_number for existing tasks that don't have one
  {
    const unnumbered = db
      .select()
      .from(schema.kanbanTasks)
      .all()
      .filter((t) => t.taskNumber == null);
    if (unnumbered.length > 0) {
      // Group by project, sort by created_at, assign sequential numbers
      const byProject = new Map<string, typeof unnumbered>();
      for (const t of unnumbered) {
        const list = byProject.get(t.projectId) ?? [];
        list.push(t);
        byProject.set(t.projectId, list);
      }
      for (const [projectId, tasks] of byProject) {
        // Find current max task_number for this project
        const allProjectTasks = db
          .select()
          .from(schema.kanbanTasks)
          .where(eq(schema.kanbanTasks.projectId, projectId))
          .all();
        let maxNum = allProjectTasks.reduce((max, t) => Math.max(max, t.taskNumber ?? 0), 0);
        tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        for (const t of tasks) {
          maxNum++;
          db.update(schema.kanbanTasks)
            .set({ taskNumber: maxNum })
            .where(eq(schema.kanbanTasks.id, t.id))
            .run();
        }
      }
      console.log(`[DB] Backfilled task_number for ${unnumbered.length} task(s)`);
    }
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Clean up legacy worktrees table (removed — agents now write directly to repo/)
  db.run(sql`DROP TABLE IF EXISTS worktrees`);

  db.run(sql`CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    api_key TEXT,
    base_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS custom_models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS token_usage (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost INTEGER,
    project_id TEXT,
    conversation_id TEXT,
    message_id TEXT,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS agent_activity (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    project_id TEXT,
    message_id TEXT,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    scopes TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, account_id)
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add reminder_at to todos
  try {
    db.run(sql`ALTER TABLE todos ADD COLUMN reminder_at TEXT`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location TEXT,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    recurrence TEXT,
    color TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
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
    scan_status TEXT NOT NULL DEFAULT 'unscanned',
    scan_findings TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS agent_skills (
    registry_entry_id TEXT NOT NULL,
    skill_id TEXT NOT NULL,
    PRIMARY KEY (registry_entry_id, skill_id)
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS custom_tools (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    parameters TEXT NOT NULL DEFAULT '[]',
    code TEXT NOT NULL,
    timeout INTEGER NOT NULL DEFAULT 30000,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add source column to skills
  try {
    db.run(sql`ALTER TABLE skills ADD COLUMN source TEXT NOT NULL DEFAULT 'created'`);
  } catch {
    // Column already exists — ignore
  }

  // Idempotent migration: add cloned_from_id column to skills
  try {
    db.run(sql`ALTER TABLE skills ADD COLUMN cloned_from_id TEXT`);
  } catch {
    // Column already exists — ignore
  }

  // Coding agent session tables (renamed from opencode_*)
  db.run(sql`CREATE TABLE IF NOT EXISTS coding_agent_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    project_id TEXT,
    task TEXT NOT NULL DEFAULT '',
    agent_type TEXT NOT NULL DEFAULT 'opencode',
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    terminal_buffer TEXT
  )`);

  // Idempotent migration: add terminal_buffer column to coding_agent_sessions
  try {
    db.run(sql`ALTER TABLE coding_agent_sessions ADD COLUMN terminal_buffer TEXT`);
  } catch {
    // Column already exists — ignore
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS coding_agent_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS coding_agent_diffs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0
  )`);

  // Soul documents table
  db.run(sql`CREATE TABLE IF NOT EXISTS soul_documents (
    id TEXT PRIMARY KEY,
    agent_role TEXT NOT NULL,
    registry_entry_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(agent_role, registry_entry_id)
  )`);

  // Memories table
  db.run(sql`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'general',
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    agent_scope TEXT,
    project_id TEXT,
    importance INTEGER NOT NULL DEFAULT 5,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Memory episodes table (daily logs)
  db.run(sql`CREATE TABLE IF NOT EXISTS memory_episodes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    project_id TEXT,
    summary TEXT NOT NULL,
    key_decisions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`);

  // Merge queue table
  db.run(sql`CREATE TABLE IF NOT EXISTS merge_queue (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    pr_branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    position INTEGER NOT NULL,
    rebase_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    approved_at TEXT NOT NULL,
    merged_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Custom scheduled tasks
  db.run(sql`CREATE TABLE IF NOT EXISTS custom_scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'notification',
    interval_ms INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Idempotent migration: add module_agent_id to custom_scheduled_tasks
  try {
    db.run(sql`ALTER TABLE custom_scheduled_tasks ADD COLUMN module_agent_id TEXT`);
  } catch { /* column already exists */ }

  // MCP servers table
  db.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    transport TEXT NOT NULL,
    command TEXT,
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    url TEXT,
    headers TEXT NOT NULL DEFAULT '{}',
    auto_start INTEGER NOT NULL DEFAULT 0,
    timeout INTEGER NOT NULL DEFAULT 30000,
    allowed_tools TEXT,
    discovered_tools TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // SSH keys table
  db.run(sql`CREATE TABLE IF NOT EXISTS ssh_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    private_key_path TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    key_type TEXT NOT NULL DEFAULT 'ed25519',
    allowed_hosts TEXT NOT NULL DEFAULT '[]',
    port INTEGER NOT NULL DEFAULT 22,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // SSH sessions table
  db.run(sql`CREATE TABLE IF NOT EXISTS ssh_sessions (
    id TEXT PRIMARY KEY,
    ssh_key_id TEXT NOT NULL,
    host TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    terminal_buffer TEXT,
    initiated_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`);

  // FTS5 full-text search index for memories
  try {
    db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      id UNINDEXED,
      content,
      category,
      tokenize='porter unicode61'
    )`);
  } catch (err) {
    console.warn("[DB] FTS5 table creation (non-fatal):", err);
  }

  // Idempotent migration: rename old opencode_* tables to coding_agent_*
  try {
    // Check if old tables exist and new ones are empty (migration needed)
    const oldExists = db.get(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='opencode_sessions'`);
    if (oldExists) {
      // Copy data from old tables to new ones
      db.run(sql`INSERT OR IGNORE INTO coding_agent_sessions (id, agent_id, session_id, project_id, task, agent_type, status, started_at, completed_at)
        SELECT id, agent_id, session_id, project_id, task, 'opencode', status, started_at, completed_at FROM opencode_sessions`);
      db.run(sql`INSERT OR IGNORE INTO coding_agent_messages (id, session_id, agent_id, role, parts, created_at)
        SELECT id, session_id, agent_id, role, parts, created_at FROM opencode_messages`);
      db.run(sql`INSERT OR IGNORE INTO coding_agent_diffs (id, session_id, path, additions, deletions)
        SELECT id, session_id, path, additions, deletions FROM opencode_diffs`);
      // Drop old tables
      db.run(sql`DROP TABLE IF EXISTS opencode_sessions`);
      db.run(sql`DROP TABLE IF EXISTS opencode_messages`);
      db.run(sql`DROP TABLE IF EXISTS opencode_diffs`);
      console.log("[DB] Migrated opencode_* tables to coding_agent_*");
    }
  } catch (err) {
    console.warn("[DB] opencode → coding_agent table migration (non-fatal):", err);
  }

  // Seed built-in registry entries on every startup (dynamic import to avoid circular dep)
  const { seedBuiltIns } = await import("./seed.js");
  seedBuiltIns();

  // Seed built-in skills and their assignments on every startup
  const { seedBuiltInSkills } = await import("../skills/seed-skills.js");
  seedBuiltInSkills();

  // One-time migration: move provider credentials from config KV to providers table
  await migrateProviders(db);
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-Compatible",
};

async function migrateProviders(db: ReturnType<typeof drizzle<typeof schema>>) {
  // Check if already migrated
  const flag = db
    .select()
    .from(schema.config)
    .where(sql`${schema.config.key} = 'providers_migrated'`)
    .get();
  if (flag) return;

  const { nanoid } = await import("nanoid");

  // Map old provider type string → new provider row ID
  const typeToId: Record<string, string> = {};

  for (const provType of ["anthropic", "openai", "ollama", "openai-compatible"]) {
    const apiKeyRow = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} = ${"provider:" + provType + ":api_key"}`)
      .get();
    const baseUrlRow = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} = ${"provider:" + provType + ":base_url"}`)
      .get();

    // Only create a provider row if credentials were actually configured
    if (!apiKeyRow && !baseUrlRow) continue;

    const id = nanoid();
    const now = new Date().toISOString();
    db.insert(schema.providers)
      .values({
        id,
        name: PROVIDER_TYPE_LABELS[provType] ?? provType,
        type: provType as "anthropic" | "openai" | "ollama" | "openai-compatible",
        apiKey: apiKeyRow?.value ?? null,
        baseUrl: baseUrlRow?.value ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    typeToId[provType] = id;
  }

  // Update tier default config values from type strings to provider row IDs
  for (const key of ["coo_provider", "team_lead_provider", "worker_provider"]) {
    const row = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} = ${key}`)
      .get();
    if (row && typeToId[row.value]) {
      db.update(schema.config)
        .set({ value: typeToId[row.value], updatedAt: new Date().toISOString() })
        .where(sql`${schema.config.key} = ${key}`)
        .run();
    }
  }

  // Update registry_entries.default_provider from type strings to provider row IDs
  const entries = db.select().from(schema.registryEntries).all();
  for (const entry of entries) {
    if (typeToId[entry.defaultProvider]) {
      db.update(schema.registryEntries)
        .set({ defaultProvider: typeToId[entry.defaultProvider] })
        .where(sql`${schema.registryEntries.id} = ${entry.id}`)
        .run();
    }
  }

  // Set migration flag
  db.insert(schema.config)
    .values({ key: "providers_migrated", value: "true", updatedAt: new Date().toISOString() })
    .run();
}

/** Reset the DB singleton (for testing) */
export function resetDb() {
  closeDatabase();
}

export { schema };
