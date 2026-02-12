import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  registryEntryId: text("registry_entry_id"),
  role: text("role", { enum: ["coo", "team_lead", "worker"] }).notNull(),
  parentId: text("parent_id"),
  status: text("status", {
    enum: ["idle", "thinking", "acting", "done", "error"],
  })
    .notNull()
    .default("idle"),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  baseUrl: text("base_url"),
  temperature: integer("temperature"),
  systemPrompt: text("system_prompt"),
  modelPackId: text("model_pack_id"),
  projectId: text("project_id"),
  workspacePath: text("workspace_path"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  fromAgentId: text("from_agent_id"),
  toAgentId: text("to_agent_id"),
  type: text("type", {
    enum: ["chat", "directive", "report", "status", "status_request", "status_response"],
  }).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .default({}),
  projectId: text("project_id"),
  conversationId: text("conversation_id"),
  correlationId: text("correlation_id"),
  timestamp: text("timestamp")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const registryEntries = sqliteTable("registry_entries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  capabilities: text("capabilities", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  defaultModel: text("default_model").notNull(),
  defaultProvider: text("default_provider").notNull(),
  tools: text("tools", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  role: text("role", { enum: ["coo", "team_lead", "worker"] })
    .notNull()
    .default("worker"),
  modelPackId: text("model_pack_id"),
  clonedFromId: text("cloned_from_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", {
    enum: ["active", "completed", "failed", "cancelled"],
  })
    .notNull()
    .default("active"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
