import { sql, eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import {
  embed,
  embedBatch,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
  isEmbeddingModelReady,
  preloadEmbeddingModel,
} from "./embeddings.js";

interface VectorEntry {
  id: string;
  vector: Float32Array;
}

/**
 * In-memory vector index for semantic search over memories.
 * Loads all embeddings on startup (~6MB for 10K memories), performs
 * brute-force cosine similarity search in JavaScript — fast enough
 * for personal-scale usage.
 *
 * Combines FTS5 keyword results + vector similarity via Reciprocal
 * Rank Fusion for hybrid retrieval.
 */
export class VectorStore {
  private index: VectorEntry[] = [];
  private loaded = false;

  /** Load all memory embeddings into the in-memory index */
  async load(): Promise<void> {
    try {
      // Ensure embedding column exists
      this.ensureEmbeddingColumn();

      const db = getDb();
      const rows = db.all(
        sql`SELECT id, embedding FROM memories WHERE embedding IS NOT NULL`,
      ) as Array<{ id: string; embedding: Buffer }>;

      this.index = rows
        .filter((r) => r.embedding)
        .map((r) => ({
          id: r.id,
          vector: blobToVector(r.embedding),
        }));

      this.loaded = true;
      console.log(`[VectorStore] Loaded ${this.index.length} memory embeddings`);
    } catch (err) {
      console.warn("[VectorStore] Failed to load embeddings:", err);
      this.loaded = true; // Mark as loaded even on failure — queries will just return empty
    }
  }

  /** Ensure the embedding column exists on the memories table */
  private ensureEmbeddingColumn() {
    try {
      const db = getDb();
      db.run(sql`ALTER TABLE memories ADD COLUMN embedding BLOB`);
    } catch {
      // Column already exists
    }
  }

  /**
   * Embed a memory's content and store the vector.
   * Call this whenever a memory is created or updated.
   */
  async embedAndStore(memoryId: string, content: string): Promise<void> {
    const vector = await embed(content);
    if (!vector) return;

    try {
      const db = getDb();
      db.run(
        sql`UPDATE memories SET embedding = ${vectorToBlob(vector)} WHERE id = ${memoryId}`,
      );

      // Update in-memory index
      const existingIdx = this.index.findIndex((e) => e.id === memoryId);
      if (existingIdx >= 0) {
        this.index[existingIdx].vector = vector;
      } else {
        this.index.push({ id: memoryId, vector });
      }
    } catch (err) {
      console.warn("[VectorStore] Failed to store embedding:", err);
    }
  }

  /** Remove a memory from the in-memory index */
  remove(memoryId: string): void {
    this.index = this.index.filter((e) => e.id !== memoryId);
  }

  /**
   * Find the top-k most semantically similar memories to a query.
   * Returns memory IDs sorted by similarity (highest first).
   */
  async search(query: string, topK: number = 10): Promise<string[]> {
    if (!this.loaded || this.index.length === 0) return [];

    const queryVec = await embed(query);
    if (!queryVec) return [];

    // Brute-force cosine similarity search
    const scored = this.index.map((entry) => ({
      id: entry.id,
      score: cosineSimilarity(queryVec, entry.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.id);
  }

  /**
   * Hybrid search combining keyword results (from FTS5/LIKE) and
   * vector similarity using Reciprocal Rank Fusion (RRF).
   *
   * @param keywordIds - Memory IDs from keyword search, ordered by relevance
   * @param vectorIds - Memory IDs from vector search, ordered by similarity
   * @param topK - Number of results to return
   * @param k - RRF constant (default 60)
   */
  hybridRank(
    keywordIds: string[],
    vectorIds: string[],
    topK: number = 10,
    k: number = 60,
  ): string[] {
    const scores = new Map<string, number>();

    // Keyword results: RRF score = 1 / (k + rank)
    for (let i = 0; i < keywordIds.length; i++) {
      const id = keywordIds[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }

    // Vector results: RRF score = 1 / (k + rank)
    for (let i = 0; i < vectorIds.length; i++) {
      const id = vectorIds[i];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    }

    // Sort by combined RRF score
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    return ranked.slice(0, topK).map(([id]) => id);
  }

  /**
   * Backfill embeddings for all memories that don't have one yet.
   * Call this during startup or as a maintenance task.
   */
  async backfillEmbeddings(): Promise<number> {
    if (!isEmbeddingModelReady()) {
      const ok = await preloadEmbeddingModel();
      if (!ok) return 0;
    }

    this.ensureEmbeddingColumn();

    const db = getDb();
    const unembedded = db.all(
      sql`SELECT id, content FROM memories WHERE embedding IS NULL`,
    ) as Array<{ id: string; content: string }>;

    if (unembedded.length === 0) return 0;

    console.log(`[VectorStore] Backfilling ${unembedded.length} memory embeddings...`);

    let count = 0;
    // Process in batches of 10
    for (let i = 0; i < unembedded.length; i += 10) {
      const batch = unembedded.slice(i, i + 10);
      const vectors = await embedBatch(batch.map((m) => m.content));

      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) continue;

        db.run(
          sql`UPDATE memories SET embedding = ${vectorToBlob(vec)} WHERE id = ${batch[j].id}`,
        );
        this.index.push({ id: batch[j].id, vector: vec });
        count++;
      }
    }

    console.log(`[VectorStore] Backfilled ${count} embeddings`);
    return count;
  }

  /** Get stats about the vector index */
  getStats(): { total: number; withEmbeddings: number } {
    const db = getDb();
    try {
      const total = (db.get(sql`SELECT count(*) as c FROM memories`) as { c: number })?.c ?? 0;
      const withEmb = (db.get(sql`SELECT count(*) as c FROM memories WHERE embedding IS NOT NULL`) as { c: number })?.c ?? 0;
      return { total, withEmbeddings: withEmb };
    } catch {
      return { total: 0, withEmbeddings: this.index.length };
    }
  }
}

/** Singleton instance */
let _vectorStore: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!_vectorStore) {
    _vectorStore = new VectorStore();
  }
  return _vectorStore;
}
