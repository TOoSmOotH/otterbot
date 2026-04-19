import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import { getDb, getRawSqlite, schema } from "../db/index.js";
import type { MemoryEntry, MemoryCategory, MemorySource, MemorySearchResult } from "@otterbot/shared";

export interface SaveMemoryInput {
  id?: string;
  category?: MemoryCategory;
  content: string;
  source?: MemorySource;
  importance?: number;
}

export class MemoryService {
  save(input: SaveMemoryInput): MemoryEntry {
    const db = getDb();
    const now = new Date().toISOString();
    const id = input.id ?? nanoid();
    const row = {
      id,
      category: input.category ?? ("general" as MemoryCategory),
      content: input.content,
      source: input.source ?? ("user" as MemorySource),
      importance: input.importance ?? 5,
      accessCount: 0,
      lastAccessedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(schema.memories).values(row).run();
    this.indexFts({ kind: "memory", refId: id, title: row.category, body: row.content, tags: "" });
    return row;
  }

  get(id: string): MemoryEntry | null {
    const db = getDb();
    return db.select().from(schema.memories).where(eq(schema.memories.id, id)).get() ?? null;
  }

  list(limit = 100): MemoryEntry[] {
    const db = getDb();
    return db.select().from(schema.memories).orderBy(sql`datetime(updated_at) desc`).limit(limit).all();
  }

  delete(id: string): void {
    const db = getDb();
    db.delete(schema.memories).where(eq(schema.memories.id, id)).run();
    this.removeFts("memory", id);
  }

  /** FTS5 search across memories + session summaries + skills. */
  search(query: string, opts: { limit?: number; kind?: string } = {}): MemorySearchResult[] {
    if (!query.trim()) return [];
    const sqlite = getRawSqlite();
    const limit = opts.limit ?? 6;
    const filter = opts.kind ? `AND kind = '${opts.kind.replace(/'/g, "")}'` : "";
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    const hits = sqlite
      .prepare(
        `SELECT kind, ref_id, title, body, bm25(content_fts) AS score
         FROM content_fts
         WHERE content_fts MATCH ? ${filter}
         ORDER BY score
         LIMIT ?`,
      )
      .all(sanitized, limit) as Array<{
        kind: string;
        ref_id: string;
        title: string;
        body: string;
        score: number;
      }>;

    const results: MemorySearchResult[] = [];
    for (const hit of hits) {
      if (hit.kind !== "memory") continue;
      const entry = this.get(hit.ref_id);
      if (!entry) continue;
      this.touch(entry.id);
      results.push({ entry, score: -hit.score, via: "fts" });
    }
    return results;
  }

  /** Search across all kinds, returning hits with their bodies for prompt injection. */
  searchContent(query: string, limit = 6): Array<{ kind: string; refId: string; title: string; body: string; score: number }> {
    if (!query.trim()) return [];
    const sqlite = getRawSqlite();
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const rows = sqlite
      .prepare(
        `SELECT kind, ref_id, title, body, bm25(content_fts) AS score
         FROM content_fts
         WHERE content_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(sanitized, limit) as Array<{
        kind: string;
        ref_id: string;
        title: string;
        body: string;
        score: number;
      }>;
    return rows.map((r) => ({
      kind: r.kind,
      refId: r.ref_id,
      title: r.title,
      body: r.body,
      score: -r.score,
    }));
  }

  touch(id: string) {
    const db = getDb();
    db.update(schema.memories)
      .set({
        accessCount: sql`access_count + 1`,
        lastAccessedAt: new Date().toISOString(),
      })
      .where(eq(schema.memories.id, id))
      .run();
  }

  indexFts(args: { kind: string; refId: string; title: string; body: string; tags: string }) {
    const sqlite = getRawSqlite();
    sqlite
      .prepare(
        `DELETE FROM content_fts WHERE kind = ? AND ref_id = ?`,
      )
      .run(args.kind, args.refId);
    sqlite
      .prepare(
        `INSERT INTO content_fts (kind, ref_id, title, body, tags) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(args.kind, args.refId, args.title, args.body, args.tags);
  }

  removeFts(kind: string, refId: string) {
    const sqlite = getRawSqlite();
    sqlite.prepare(`DELETE FROM content_fts WHERE kind = ? AND ref_id = ?`).run(kind, refId);
  }
}

let _svc: MemoryService | null = null;
export function getMemoryService(): MemoryService {
  if (!_svc) _svc = new MemoryService();
  return _svc;
}

/**
 * FTS5 MATCH has a specific syntax. User text can contain characters that
 * would be treated as operators. We strip non-word characters and wrap each
 * token in quotes so the query degrades gracefully to a keyword bag.
 */
export function sanitizeFtsQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 20);
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
