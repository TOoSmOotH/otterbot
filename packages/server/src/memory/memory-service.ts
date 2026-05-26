import { nanoid } from "nanoid";
import type Database from "better-sqlite3-multiple-ciphers";
import { eq, sql } from "drizzle-orm";
import type { AgentDrizzle } from "../db/agent-db.js";
import * as schema from "../db/schema.js";
import type { VecIndex } from "../vec-index.js";
import { getDefaultContext } from "../runtime/default-agent.js";
import type {
  MemoryEntry,
  MemoryCategory,
  MemorySource,
  MemorySearchResult,
  ExportedMemory,
} from "@otterbot/shared";

export interface SaveMemoryInput {
  id?: string;
  category?: MemoryCategory;
  content: string;
  source?: MemorySource;
  importance?: number;
  entityRefs?: string[];
  temporalMarker?: "current" | "past" | "upcoming";
}

/**
 * Per-agent memory service: hybrid FTS5 + vector search over the agent's own
 * isolated database. One instance per agent.
 */
export class MemoryService {
  constructor(
    private readonly db: AgentDrizzle,
    private readonly sqlite: Database.Database,
    private readonly vec: VecIndex
  ) {}

  save(input: SaveMemoryInput): MemoryEntry {
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
      entityRefs: input.entityRefs ?? [],
      temporalMarker: input.temporalMarker ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(schema.memories).values(row).run();
    this.indexFts({ kind: "memory", refId: id, title: row.category, body: row.content, tags: "" });
    void this.vec.insert(id, row.content);
    return row;
  }

  get(id: string): MemoryEntry | null {
    return this.db.select().from(schema.memories).where(eq(schema.memories.id, id)).get() ?? null;
  }

  list(limit = 100): MemoryEntry[] {
    return this.db
      .select()
      .from(schema.memories)
      .orderBy(sql`datetime(updated_at) desc`)
      .limit(limit)
      .all();
  }

  delete(id: string): void {
    this.db.delete(schema.memories).where(eq(schema.memories.id, id)).run();
    this.removeFts("memory", id);
    this.vec.delete(id);
  }

  /**
   * Erase every memory: the rows, their FTS index entries, and their vectors.
   * Used by a full agent reset; skills and other content are left untouched.
   */
  clear(): void {
    this.db.delete(schema.memories).run();
    this.sqlite.prepare(`DELETE FROM content_fts WHERE kind = 'memory'`).run();
    this.vec.clear();
  }

  /** All memories as full rows, for lossless export. Unlike `list`, unlimited. */
  exportAll(): ExportedMemory[] {
    return this.db
      .select()
      .from(schema.memories)
      .orderBy(sql`datetime(created_at) asc`)
      .all() as ExportedMemory[];
  }

  /**
   * Merge-import memories from an export. Each row gets a fresh id to avoid PK
   * collisions, but its original timestamps, access stats, entity refs and
   * temporal marker are preserved. Re-indexes FTS and re-embeds with this
   * agent's own model (so exports are portable across embedding dimensions);
   * awaits embedding so the import is fully durable before returning.
   * Returns the number of memories inserted.
   */
  async importMany(rows: ExportedMemory[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const id = nanoid();
      this.db
        .insert(schema.memories)
        .values({
          id,
          category: row.category,
          content: row.content,
          source: row.source,
          importance: row.importance,
          accessCount: row.accessCount,
          lastAccessedAt: row.lastAccessedAt,
          entityRefs: row.entityRefs ?? [],
          temporalMarker: row.temporalMarker ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })
        .run();
      this.indexFts({ kind: "memory", refId: id, title: row.category, body: row.content, tags: "" });
      await this.vec.insert(id, row.content);
      inserted++;
    }
    return inserted;
  }

  /**
   * Hybrid search: fuses FTS5 keyword scores with vector cosine distance.
   * Returns top-N memories ranked by combined relevance.
   */
  async search(query: string, opts: { limit?: number; kind?: string } = {}): Promise<MemorySearchResult[]> {
    if (!query.trim()) return [];
    const limit = opts.limit ?? 6;

    const ftsHits = this.searchFts(query, { limit: limit * 2, kind: opts.kind });
    const ftsMap = new Map<string, number>();
    for (const hit of ftsHits) {
      if (hit.kind !== "memory") continue;
      ftsMap.set(hit.refId, hit.score);
    }

    const vecHits = await this.vec.search(query, limit * 2);
    const vecMap = new Map<string, number>();
    for (const hit of vecHits) {
      vecMap.set(hit.memoryId, 1 / (1 + hit.distance));
    }

    const allIds = new Set([...ftsMap.keys(), ...vecMap.keys()]);
    const scored: Array<{ id: string; score: number }> = [];
    for (const id of allIds) {
      const ftsScore = ftsMap.get(id) ?? 0;
      const vecScore = vecMap.get(id) ?? 0;
      const overlapBoost = ftsMap.has(id) && vecMap.has(id) ? 0.1 : 0;
      scored.push({ id, score: ftsScore * 0.5 + vecScore * 0.4 + overlapBoost });
    }
    scored.sort((a, b) => b.score - a.score);

    const results: MemorySearchResult[] = [];
    for (const item of scored.slice(0, limit)) {
      const entry = this.get(item.id);
      if (!entry) continue;
      this.touch(entry.id);
      const via =
        ftsMap.has(item.id) && vecMap.has(item.id)
          ? "hybrid"
          : ftsMap.has(item.id)
            ? "fts"
            : "vector";
      results.push({ entry, score: item.score, via });
    }
    return results;
  }

  /** Search across all kinds, returning hits with their bodies for prompt injection. */
  async searchContent(
    query: string,
    limit = 6
  ): Promise<Array<{ kind: string; refId: string; title: string; body: string; score: number }>> {
    if (!query.trim()) return [];

    const ftsHits = this.searchFts(query, { limit: limit * 2 });
    const vecHits = await this.vec.search(query, limit * 2);
    const vecMap = new Map<string, number>();
    for (const hit of vecHits) {
      vecMap.set(hit.memoryId, 1 / (1 + hit.distance));
    }

    const ftsMap = new Map<string, (typeof ftsHits)[0]>();
    for (const hit of ftsHits) ftsMap.set(hit.refId, hit);

    const allIds = new Set([...ftsMap.keys(), ...vecMap.keys()]);
    const scored: Array<{ refId: string; score: number }> = [];
    for (const refId of allIds) {
      const ftsHit = ftsMap.get(refId);
      const ftsScore = ftsHit?.score ?? 0;
      const vecScore = vecMap.get(refId) ?? 0;
      const overlapBoost = ftsMap.has(refId) && vecMap.has(refId) ? 0.1 : 0;
      scored.push({ refId, score: ftsScore * 0.5 + vecScore * 0.4 + overlapBoost });
    }
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => {
      const hit = ftsMap.get(s.refId);
      return {
        kind: hit?.kind ?? "memory",
        refId: s.refId,
        title: hit?.title ?? "",
        body: hit?.body ?? "",
        score: s.score,
      };
    });
  }

  private searchFts(
    query: string,
    opts: { limit: number; kind?: string }
  ): Array<{ kind: string; refId: string; title: string; body: string; score: number }> {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];
    const filter = opts.kind ? `AND kind = '${opts.kind.replace(/'/g, "")}'` : "";
    const rows = this.sqlite
      .prepare(
        `SELECT kind, ref_id, title, body, bm25(content_fts) AS score
         FROM content_fts
         WHERE content_fts MATCH ? ${filter}
         ORDER BY score
         LIMIT ?`
      )
      .all(sanitized, opts.limit) as Array<{
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
    this.db
      .update(schema.memories)
      .set({ accessCount: sql`access_count + 1`, lastAccessedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, id))
      .run();
  }

  indexFts(args: { kind: string; refId: string; title: string; body: string; tags: string }) {
    this.sqlite
      .prepare(`DELETE FROM content_fts WHERE kind = ? AND ref_id = ?`)
      .run(args.kind, args.refId);
    this.sqlite
      .prepare(`INSERT INTO content_fts (kind, ref_id, title, body, tags) VALUES (?, ?, ?, ?, ?)`)
      .run(args.kind, args.refId, args.title, args.body, args.tags);
  }

  removeFts(kind: string, refId: string) {
    this.sqlite.prepare(`DELETE FROM content_fts WHERE kind = ? AND ref_id = ?`).run(kind, refId);
  }
}

/** @deprecated Compatibility shim — resolves to the default (COO) agent's memory service. */
export function getMemoryService(): MemoryService {
  return getDefaultContext().memory;
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
