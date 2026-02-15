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

  // Seed built-in registry entries on every startup (dynamic import to avoid circular dep)
  const { seedBuiltIns } = await import("./seed.js");
  seedBuiltIns();

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
  _db = null;
}

export { schema };
