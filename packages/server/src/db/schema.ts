import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import type {
  MemoryCategory,
  MemorySource,
  SkillScanStatus,
  ScanFinding,
  SkillSource,
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
  body: text("body").notNull().default(""),
  source: text("source").$type<SkillSource>().notNull().default("authored"),
  scanStatus: text("scan_status").$type<SkillScanStatus>().notNull().default("unscanned"),
  scanFindings: text("scan_findings", { mode: "json" })
    .$type<ScanFinding[]>()
    .notNull()
    .default([]),
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
 * Populated only if ENABLE_EMBEDDINGS is set; FTS remains the primary
 * recall channel.
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
