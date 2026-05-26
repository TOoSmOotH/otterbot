import type Database from "better-sqlite3-multiple-ciphers";
import type { EmbeddingService } from "./embedding.js";

export interface VecSearchHit {
  memoryId: string;
  distance: number;
}

/**
 * Per-agent vector index over the agent DB's `vec_memories` (vec0) table.
 * One instance per agent — replaces the former module-level functions.
 */
export class VecIndex {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly embedding: EmbeddingService
  ) {}

  /** Insert a memory's embedding. Best-effort: skips if vec is unavailable. */
  async insert(memoryId: string, text: string): Promise<void> {
    if (!this.embedding.isAvailable()) return;
    const vec = await this.embedding.generate(text);
    if (!vec) return;
    this.sqlite
      .prepare("INSERT OR REPLACE INTO vec_memories (memory_id, embedding) VALUES (?, ?)")
      .run(memoryId, toBlob(vec));
  }

  /** Delete a memory's embedding. */
  delete(memoryId: string): void {
    if (!this.embedding.isAvailable()) return;
    this.sqlite.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(memoryId);
  }

  /** Delete every stored embedding. Used by a full agent reset. */
  clear(): void {
    if (!this.embedding.isAvailable()) return;
    this.sqlite.prepare("DELETE FROM vec_memories").run();
  }

  /** KNN search via vec0. Returns top-N closest memories by cosine distance. */
  async search(query: string, limit = 6): Promise<VecSearchHit[]> {
    if (!this.embedding.isAvailable()) return [];
    const vec = await this.embedding.generate(query);
    if (!vec) return [];
    const rows = this.sqlite
      .prepare(
        `SELECT memory_id, distance
         FROM vec_memories
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT ?`
      )
      .all(toBlob(vec), limit) as Array<{ memory_id: string; distance: number }>;
    return rows.map((r) => ({ memoryId: r.memory_id, distance: r.distance }));
  }

  /** Regenerate embeddings for memories that lack a vec0 entry. */
  async reindexAll(): Promise<void> {
    if (!this.embedding.isAvailable()) return;
    const rows = this.sqlite
      .prepare(
        `SELECT m.id, m.content
         FROM memories m
         LEFT JOIN vec_memories v ON m.id = v.memory_id
         WHERE v.memory_id IS NULL`
      )
      .all() as Array<{ id: string; content: string }>;

    for (const row of rows) {
      try {
        await this.insert(row.id, row.content);
      } catch (err) {
        console.warn(
          "[vec-index] reindex failed for",
          row.id,
          err instanceof Error ? err.message : String(err)
        );
      }
    }
    console.info(`[vec-index] reindexed ${rows.length} memories`);
  }

  /** Count how many vectors are currently stored. */
  count(): number {
    if (!this.embedding.isAvailable()) return 0;
    const row = this.sqlite.prepare("SELECT COUNT(*) as c FROM vec_memories").get() as {
      c: number;
    };
    return row.c;
  }
}

/** Convert a Float32Array embedding to a Node Buffer for SQLite binding. */
function toBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
