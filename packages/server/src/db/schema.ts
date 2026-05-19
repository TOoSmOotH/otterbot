import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type {
  MemoryCategory,
  MemorySource,
  SkillScanStatus,
  ScanFinding,
  SkillSource,
  McpServerConfig,
} from "@otterbot/shared";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  closedAt: text("closed_at"),
  messageCount: integer("message_count").notNull().default(0),
  lastCompactedAt: text("last_compacted_at"),
});

/**
 * The running compacted summary of a conversation — one row per conversation,
 * upserted each time the oldest turns are folded into a recap to keep the live
 * context within its token budget. Distinct from `session_summaries`, which is
 * the end-of-session learning artifact.
 */
export const conversationRecaps = sqliteTable("conversation_recaps", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  recap: text("recap").notNull(),
  keyPoints: text("key_points", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  /** Id of the last message folded into the recap — the compaction watermark. */
  coveredThroughMessageId: text("covered_through_message_id").notNull(),
  coveredMessageCount: integer("covered_message_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role", { enum: ["user", "assistant", "system", "tool"] }).notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls", { mode: "json" })
    .$type<unknown[] | null>()
    .default(null),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const sessionSummaries = sqliteTable("session_summaries", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  summary: text("summary").notNull(),
  keyPoints: text("key_points", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  category: text("category").$type<MemoryCategory>().notNull().default("general"),
  content: text("content").notNull(),
  source: text("source").$type<MemorySource>().notNull().default("user"),
  importance: integer("importance").notNull().default(5),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: text("last_accessed_at"),
  entityRefs: text("entity_refs", { mode: "json" }).$type<string[]>().notNull().default([]),
  temporalMarker: text("temporal_marker").$type<"current" | "past" | "upcoming">(),
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
  tools: text("tools", { mode: "json" }).$type<string[]>().notNull().default([]),
  capabilities: text("capabilities", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  parameters: text("parameters", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  mcpServers: text("mcp_servers", { mode: "json" })
    .$type<McpServerConfig[]>()
    .notNull()
    .default([]),
  body: text("body").notNull().default(""),
  source: text("source").$type<SkillSource>().notNull().default("authored"),
  scanStatus: text("scan_status").$type<SkillScanStatus>().notNull().default("unscanned"),
  scanFindings: text("scan_findings", { mode: "json" })
    .$type<ScanFinding[]>()
    .notNull()
    .default([]),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  useCount: integer("use_count").notNull().default(0),
  filePath: text("file_path"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Single-row table. Row id is always "singleton". Stores a JSON-encoded
 * UserProfile so we can evolve the profile shape without migrating rows.
 */
export const userProfile = sqliteTable("user_profile", {
  id: text("id").primaryKey().default("singleton"),
  profileJson: text("profile_json").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Optional vector embedding storage for a memory/summary/skill row.
 * Legacy table; sqlite-vec vec0 virtual table is preferred for new installs.
 */
export const embeddings = sqliteTable("embeddings", {
  id: text("id").primaryKey(),
  refKind: text("ref_kind").notNull(),
  refId: text("ref_id").notNull(),
  vector: text("vector").notNull(), // JSON-encoded Float32Array
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

/**
 * Key-value store for vec0 configuration (e.g. embedding dimension).
 */
export const vecConfig = sqliteTable("vec_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Inbound agent-to-agent messages queued for this agent's runtime to process.
 * The runtime drains handled rows; the durable cross-agent log is `bus_messages`
 * in the control DB.
 */
export const inbox = sqliteTable("inbox", {
  id: text("id").primaryKey(),
  fromAgentId: text("from_agent_id").notNull(),
  threadId: text("thread_id").notNull(),
  correlationId: text("correlation_id"),
  body: text("body").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>().default(null),
  handled: integer("handled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
