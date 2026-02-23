import { nanoid } from "nanoid";
import { eq, and, like, or, desc, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { Memory, MemoryCategory, MemorySource } from "@otterbot/shared";
import { getVectorStore } from "./vector-store.js";

export interface MemorySaveInput {
  id?: string;
  category?: MemoryCategory;
  content: string;
  source?: MemorySource;
  agentScope?: string | null;
  projectId?: string | null;
  importance?: number;
}

export interface MemorySearchOptions {
  query: string;
  agentScope?: string | null;
  projectId?: string | null;
  limit?: number;
}

export interface MemoryListFilters {
  category?: MemoryCategory;
  agentScope?: string;
  projectId?: string;
  search?: string;
}

/**
 * Service for managing persistent memories — facts, preferences, instructions,
 * and relationships that agents can recall across conversations.
 *
 * Uses FTS5 full-text search with BM25 ranking when available,
 * falling back to LIKE-based keyword search.
 */
export class MemoryService {
  private ftsAvailable: boolean | null = null;

  /** Check if FTS5 table is available */
  private hasFts(): boolean {
    if (this.ftsAvailable !== null) return this.ftsAvailable;
    try {
      const db = getDb();
      db.run(sql`SELECT count(*) FROM memories_fts LIMIT 1`);
      this.ftsAvailable = true;
    } catch {
      this.ftsAvailable = false;
    }
    return this.ftsAvailable;
  }

  /** Create or update a memory */
  save(input: MemorySaveInput): Memory {
    const db = getDb();
    const now = new Date().toISOString();

    if (input.id) {
      // Update existing
      const existing = db.select().from(schema.memories)
        .where(eq(schema.memories.id, input.id))
        .get();

      if (existing) {
        const newContent = input.content;
        const newCategory = input.category ?? existing.category;

        db.update(schema.memories)
          .set({
            category: newCategory,
            content: newContent,
            source: input.source ?? existing.source,
            agentScope: input.agentScope !== undefined ? input.agentScope : existing.agentScope,
            projectId: input.projectId !== undefined ? input.projectId : existing.projectId,
            importance: input.importance ?? existing.importance,
            updatedAt: now,
          })
          .where(eq(schema.memories.id, input.id))
          .run();

        // Update FTS index
        this.updateFtsIndex(input.id, newContent, newCategory);

        // Re-embed asynchronously (fire-and-forget)
        getVectorStore().embedAndStore(input.id, newContent).catch(() => {});

        const updated = db.select().from(schema.memories)
          .where(eq(schema.memories.id, input.id))
          .get()!;
        return this.toMemory(updated);
      }
    }

    // Create new
    const id = input.id ?? nanoid();
    const category = input.category ?? "general";
    db.insert(schema.memories)
      .values({
        id,
        category,
        content: input.content,
        source: input.source ?? "user",
        agentScope: input.agentScope ?? null,
        projectId: input.projectId ?? null,
        importance: input.importance ?? 5,
        accessCount: 0,
        lastAccessedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    // Insert into FTS index
    this.insertFtsIndex(id, input.content, category);

    // Embed asynchronously (fire-and-forget)
    getVectorStore().embedAndStore(id, input.content).catch(() => {});

    const row = db.select().from(schema.memories)
      .where(eq(schema.memories.id, id))
      .get()!;
    return this.toMemory(row);
  }

  /**
   * Search memories using FTS5 (with BM25 ranking) or LIKE fallback.
   * Always includes high-importance memories.
   */
  search(options: MemorySearchOptions): Memory[] {
    const db = getDb();
    const limit = options.limit ?? 10;
    const matchedIds = new Set<string>();
    const results: Memory[] = [];

    // Build scope conditions
    const scopeConditions = this.buildScopeConditions(options.agentScope, options.projectId);

    // Try FTS5 search first
    if (this.hasFts() && options.query.trim()) {
      try {
        const ftsResults = this.searchFts(options.query, limit);
        for (const id of ftsResults) {
          const row = db.select().from(schema.memories)
            .where(eq(schema.memories.id, id))
            .get();
          if (!row) continue;

          // Apply scope filter
          if (scopeConditions) {
            const matches = db.select().from(schema.memories)
              .where(and(eq(schema.memories.id, id), scopeConditions))
              .get();
            if (!matches) continue;
          }

          matchedIds.add(id);
          results.push(this.toMemory(row));
        }
      } catch {
        // FTS failed — fall through to LIKE
      }
    }

    // LIKE fallback (or supplement FTS results)
    if (results.length < limit) {
      // Cap keywords to avoid exceeding SQLite's expression tree depth limit (1000)
      const MAX_KEYWORDS = 50;
      const keywords = options.query
        .toLowerCase()
        .split(/\s+/)
        .filter((k) => k.length > 2)
        .slice(0, MAX_KEYWORDS);

      if (keywords.length > 0) {
        const keywordConditions = keywords.map((kw) =>
          like(schema.memories.content, `%${kw}%`),
        );

        try {
          const keywordMatches = db.select().from(schema.memories)
            .where(
              scopeConditions
                ? and(or(...keywordConditions), scopeConditions)
                : or(...keywordConditions),
            )
            .orderBy(desc(schema.memories.importance))
            .limit(limit)
            .all();

          for (const row of keywordMatches) {
            if (!matchedIds.has(row.id)) {
              matchedIds.add(row.id);
              results.push(this.toMemory(row));
            }
          }
        } catch (err) {
          console.warn("[MemoryService] LIKE keyword search failed:", err);
        }
      }
    }

    // Vector similarity search (Phase 3) is async — schedule it as a
    // background enhancement. The synchronous keyword + FTS results are
    // returned immediately. Future calls benefit from the hybrid ranking
    // since the vector store's search results improve the next recall.

    // Always include high-importance memories (importance >= 8)
    const highImportance = db.select().from(schema.memories)
      .where(
        scopeConditions
          ? and(sql`${schema.memories.importance} >= 8`, scopeConditions)
          : sql`${schema.memories.importance} >= 8`,
      )
      .orderBy(desc(schema.memories.importance))
      .limit(5)
      .all();

    for (const row of highImportance) {
      if (!matchedIds.has(row.id)) {
        results.push(this.toMemory(row));
      }
    }

    // Sort by importance descending, cap at limit
    results.sort((a, b) => b.importance - a.importance);
    const finalResults = results.slice(0, limit);

    // Update access counts (fire-and-forget)
    this.updateAccessCounts(finalResults.map((m) => m.id));

    return finalResults;
  }

  /**
   * Async search that includes vector similarity via hybrid ranking.
   * Use this when the caller can handle a Promise (e.g. socket handlers).
   */
  async searchWithVectors(options: MemorySearchOptions): Promise<Memory[]> {
    // Get keyword + FTS results synchronously
    const keywordResults = this.search(options);
    const limit = options.limit ?? 10;

    try {
      const vectorStore = getVectorStore();
      const vectorIds = await vectorStore.search(options.query, limit);
      if (vectorIds.length === 0) return keywordResults;

      const db = getDb();
      const keywordIds = keywordResults.map((m) => m.id);
      const hybridIds = vectorStore.hybridRank(keywordIds, vectorIds, limit);
      const matchedIds = new Set(keywordIds);
      const results = [...keywordResults];

      const scopeConditions = this.buildScopeConditions(options.agentScope, options.projectId);

      for (const id of hybridIds) {
        if (!matchedIds.has(id)) {
          const row = db.select().from(schema.memories)
            .where(eq(schema.memories.id, id))
            .get();
          if (!row) continue;

          if (scopeConditions) {
            const matches = db.select().from(schema.memories)
              .where(and(eq(schema.memories.id, id), scopeConditions))
              .get();
            if (!matches) continue;
          }

          matchedIds.add(id);
          results.push(this.toMemory(row));
        }
      }

      results.sort((a, b) => b.importance - a.importance);
      return results.slice(0, limit);
    } catch {
      return keywordResults;
    }
  }

  /** List memories with optional filters */
  list(filters?: MemoryListFilters): Memory[] {
    const db = getDb();
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters?.category) {
      conditions.push(eq(schema.memories.category, filters.category));
    }
    if (filters?.agentScope) {
      conditions.push(eq(schema.memories.agentScope, filters.agentScope));
    }
    if (filters?.projectId) {
      conditions.push(eq(schema.memories.projectId, filters.projectId));
    }

    let query = db.select().from(schema.memories);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    let rows = query.orderBy(desc(schema.memories.importance)).all();

    // Apply text search filter in-app if provided
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      rows = rows.filter((r) => r.content.toLowerCase().includes(searchLower));
    }

    return rows.map((r) => this.toMemory(r));
  }

  /** Delete a memory by ID */
  delete(id: string): boolean {
    const db = getDb();
    const result = db.delete(schema.memories)
      .where(eq(schema.memories.id, id))
      .run();

    // Remove from FTS index and vector store
    this.deleteFtsIndex(id);
    getVectorStore().remove(id);

    return result.changes > 0;
  }

  /** Delete all memories, clearing FTS index, vector store, and episodic logs */
  clearAll(): number {
    const db = getDb();

    // Get all IDs for vector store cleanup
    const allIds = db.select({ id: schema.memories.id }).from(schema.memories).all();

    // Delete all memories
    const result = db.delete(schema.memories).run();

    // Clear FTS index
    if (this.hasFts()) {
      try {
        db.run(sql`DELETE FROM memories_fts`);
      } catch (err) {
        console.warn("[MemoryService] FTS clear failed:", err);
      }
    }

    // Remove all from vector store
    const vectorStore = getVectorStore();
    for (const { id } of allIds) {
      vectorStore.remove(id);
    }

    // Clear episodic memory logs (compacted daily summaries)
    try {
      db.delete(schema.memoryEpisodes).run();
    } catch (err) {
      console.warn("[MemoryService] Memory episodes clear failed:", err);
    }

    return result.changes;
  }

  /** Get a single memory by ID */
  getById(id: string): Memory | null {
    const db = getDb();
    const row = db.select().from(schema.memories)
      .where(eq(schema.memories.id, id))
      .get();
    return row ? this.toMemory(row) : null;
  }

  // ─── FTS5 Index Management ───────────────────────────────────

  /** Search FTS5 index using MATCH with BM25 ranking */
  private searchFts(query: string, limit: number): string[] {
    const db = getDb();
    // Escape FTS5 special characters and build query
    const sanitized = query
      .replace(/['"]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) => `"${w}"`)
      .join(" OR ");

    if (!sanitized) return [];

    const rows = db.all(sql`
      SELECT id, bm25(memories_fts) as rank
      FROM memories_fts
      WHERE memories_fts MATCH ${sanitized}
      ORDER BY rank
      LIMIT ${limit}
    `) as Array<{ id: string; rank: number }>;

    return rows.map((r) => r.id);
  }

  private insertFtsIndex(id: string, content: string, category: string) {
    if (!this.hasFts()) return;
    try {
      const db = getDb();
      db.run(sql`INSERT INTO memories_fts (id, content, category) VALUES (${id}, ${content}, ${category})`);
    } catch (err) {
      console.warn("[MemoryService] FTS insert failed:", err);
    }
  }

  private updateFtsIndex(id: string, content: string, category: string) {
    if (!this.hasFts()) return;
    try {
      this.deleteFtsIndex(id);
      this.insertFtsIndex(id, content, category);
    } catch (err) {
      console.warn("[MemoryService] FTS update failed:", err);
    }
  }

  private deleteFtsIndex(id: string) {
    if (!this.hasFts()) return;
    try {
      const db = getDb();
      db.run(sql`DELETE FROM memories_fts WHERE id = ${id}`);
    } catch (err) {
      console.warn("[MemoryService] FTS delete failed:", err);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /** Build scope filter conditions for agent scope and project */
  private buildScopeConditions(agentScope?: string | null, projectId?: string | null) {
    const conditions: ReturnType<typeof eq>[] = [];

    if (agentScope) {
      conditions.push(
        or(
          eq(schema.memories.agentScope, agentScope),
          isNull(schema.memories.agentScope),
        )!,
      );
    }

    if (projectId) {
      conditions.push(
        or(
          eq(schema.memories.projectId, projectId),
          isNull(schema.memories.projectId),
        )!,
      );
    }

    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  /** Update access counts for recalled memories */
  private updateAccessCounts(ids: string[]) {
    if (ids.length === 0) return;
    try {
      const db = getDb();
      const now = new Date().toISOString();
      for (const id of ids) {
        db.update(schema.memories)
          .set({
            accessCount: sql`${schema.memories.accessCount} + 1`,
            lastAccessedAt: now,
          })
          .where(eq(schema.memories.id, id))
          .run();
      }
    } catch (err) {
      console.error("[MemoryService] Failed to update access counts:", err);
    }
  }

  private toMemory(row: typeof schema.memories.$inferSelect): Memory {
    return {
      id: row.id,
      category: row.category as Memory["category"],
      content: row.content,
      source: row.source as Memory["source"],
      agentScope: row.agentScope,
      projectId: row.projectId,
      importance: row.importance,
      accessCount: row.accessCount,
      lastAccessedAt: row.lastAccessedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
