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
  gearConfig: text("gear_config"),
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
  projectId: text("project_id"),
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
  gearConfig: text("gear_config"),
  promptAddendum: text("prompt_addendum"),
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
  charter: text("charter"),
  charterStatus: text("charter_status", {
    enum: ["gathering", "finalized"],
  }).default("gathering"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const kanbanTasks = sqliteTable("kanban_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  column: text("column", {
    enum: ["backlog", "in_progress", "done"],
  })
    .notNull()
    .default("backlog"),
  position: integer("position").notNull().default(0),
  assigneeAgentId: text("assignee_agent_id"),
  createdBy: text("created_by"),
  labels: text("labels", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  blockedBy: text("blocked_by", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  completionReport: text("completion_report"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const agentActivity = sqliteTable("agent_activity", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  type: text("type", { enum: ["thinking", "response", "tool_call"] }).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata", { mode: "json" })
    .$type<Record<string, unknown>>()
    .default({}),
  projectId: text("project_id"),
  messageId: text("message_id"),
  timestamp: text("timestamp")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const customModels = sqliteTable("custom_models", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  label: text("label"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["anthropic", "openai", "ollama", "openai-compatible"],
  }).notNull(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

