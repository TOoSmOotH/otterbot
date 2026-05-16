import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Control-plane schema. A single shared `control.db` holds only cross-agent
 * records: the agent registry, the global agent-to-agent message log, the
 * subagent spawn-task tree, and cron schedules. Per-agent data (memories,
 * skills, conversations, vectors) lives in each agent's isolated `agent.db`.
 */

/** Registry of every agent profile known to the orchestrator. */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["coo", "agent", "subagent"] }).notNull().default("agent"),
  profileDir: text("profile_dir").notNull(),
  status: text("status").notNull().default("idle"),
  parentId: text("parent_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Global agent-to-agent message log. Every bus message is written here first
 * so the UI can replay the full history regardless of transport.
 */
export const busMessages = sqliteTable("bus_messages", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull(),
  kind: text("kind").notNull(),
  fromAgentId: text("from_agent_id").notNull(),
  toAgentId: text("to_agent_id"),
  threadId: text("thread_id").notNull(),
  correlationId: text("correlation_id"),
  rootSpawnId: text("root_spawn_id"),
  body: text("body").notNull().default(""),
  payload: text("payload", { mode: "json" }).$type<unknown>().default(null),
  status: text("status"),
  transport: text("transport").notNull().default("local"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/** Spawn-task tree: one row per subagent created to perform a unit of work. */
export const subagentTasks = sqliteTable("subagent_tasks", {
  id: text("id").primaryKey(),
  rootId: text("root_id").notNull(),
  parentTaskId: text("parent_task_id"),
  parentAgentId: text("parent_agent_id").notNull(),
  subagentId: text("subagent_id").notNull(),
  goal: text("goal").notNull(),
  status: text("status", {
    enum: ["queued", "running", "done", "failed", "cancelled"],
  })
    .notNull()
    .default("queued"),
  resultSummary: text("result_summary"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  finishedAt: text("finished_at"),
});

/**
 * Per-agent credentials (API keys, tokens, SMTP, model endpoints). Stored here
 * — encrypted at rest with the database key — instead of plaintext `.env`
 * files. One row per (agent, key).
 */
export const agentSecrets = sqliteTable("agent_secrets", {
  agentId: text("agent_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
});

/** App-level key/value settings (e.g. onboarding completion). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Cron-scheduled prompts fired against an agent. */
export const scheduledTasks = sqliteTable("scheduled_tasks", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  cron: text("cron").notNull(),
  prompt: text("prompt").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: text("last_run_at"),
  nextRunAt: text("next_run_at"),
});
