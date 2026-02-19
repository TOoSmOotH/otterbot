import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import type { ScanFinding, SkillScanStatus, OpenCodePart } from "@otterbot/shared";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  registryEntryId: text("registry_entry_id"),
  role: text("role", { enum: ["coo", "team_lead", "worker", "admin_assistant"] }).notNull(),
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
  role: text("role", { enum: ["coo", "team_lead", "worker", "admin_assistant"] })
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
  retryCount: integer("retry_count").notNull().default(0),
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

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const tokenUsage = sqliteTable("token_usage", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cost: integer("cost"), // cost in microcents (1/10000 of a cent) for precision without floats
  projectId: text("project_id"),
  conversationId: text("conversation_id"),
  messageId: text("message_id"),
  timestamp: text("timestamp")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: text("expires_at"),
  scopes: text("scopes"),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const todos = sqliteTable("todos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["todo", "in_progress", "done"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  dueDate: text("due_date"),
  tags: text("tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  location: text("location"),
  start: text("start").notNull(),
  end: text("end").notNull(),
  allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
  recurrence: text("recurrence", { mode: "json" })
    .$type<string[] | null>()
    .default(null),
  color: text("color"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: ["anthropic", "openai", "ollama", "openai-compatible", "openrouter"],
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

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default("1.0.0"),
  author: text("author").notNull().default(""),
  tools: text("tools", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  capabilities: text("capabilities", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  parameters: text("parameters", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  tags: text("tags", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  body: text("body").notNull().default(""),
  source: text("source", {
    enum: ["built-in", "created", "imported", "cloned"],
  })
    .notNull()
    .default("created"),
  clonedFromId: text("cloned_from_id"),
  scanStatus: text("scan_status", {
    enum: ["clean", "warnings", "errors", "unscanned"],
  })
    .$type<SkillScanStatus>()
    .notNull()
    .default("unscanned"),
  scanFindings: text("scan_findings", { mode: "json" })
    .$type<ScanFinding[]>()
    .notNull()
    .default([]),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const customTools = sqliteTable("custom_tools", {
  id: text("id").primaryKey(),
  name: text("name").unique().notNull(),
  description: text("description").notNull(),
  parameters: text("parameters", { mode: "json" })
    .$type<{ name: string; type: string; required: boolean; description: string }[]>()
    .notNull()
    .default([]),
  code: text("code").notNull(),
  timeout: integer("timeout").notNull().default(30000),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const agentSkills = sqliteTable(
  "agent_skills",
  {
    registryEntryId: text("registry_entry_id").notNull(),
    skillId: text("skill_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.registryEntryId, table.skillId] })],
);

export const opencodeSessions = sqliteTable("opencode_sessions", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  sessionId: text("session_id").notNull().default(""),
  projectId: text("project_id"),
  task: text("task").notNull().default(""),
  status: text("status", {
    enum: ["active", "idle", "completed", "error", "awaiting-input"],
  })
    .notNull()
    .default("active"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const opencodeMessages = sqliteTable("opencode_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  agentId: text("agent_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  parts: text("parts", { mode: "json" })
    .$type<OpenCodePart[]>()
    .notNull()
    .default([]),
  createdAt: text("created_at").notNull(),
});

export const opencodeDiffs = sqliteTable("opencode_diffs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  path: text("path").notNull(),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
});

