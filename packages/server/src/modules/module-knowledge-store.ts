/**
 * Isolated per-module knowledge store.
 *
 * Each module gets its own SQLite database at ./data/modules/<id>/knowledge.db
 * with FTS5 full-text search and in-memory vector index for hybrid retrieval.
 */

import Database from "better-sqlite3-multiple-ciphers";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { KnowledgeStore, KnowledgeDocument } from "@otterbot/shared";
import {
  embed,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
} from "../memory/embeddings.js";

interface VectorEntry {
  id: string;
  vector: Float32Array;
}

export class ModuleKnowledgeStore implements KnowledgeStore {
  readonly db: Database.Database;
  private vectorIndex: VectorEntry[] = [];
  private loaded = false;

  constructor(moduleId: string, dataDir?: string) {
    const baseDir = dataDir ?? resolve("./data/modules", moduleId);
    mkdirSync(baseDir, { recursive: true });

    const dbPath = resolve(baseDir, "knowledge.db");
    this.db = new Database(dbPath);

    // No encryption — module data is ingested public content
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.createBaseTables();
    this.loadVectorIndex();
  }

  private createBaseTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT,
        embedding BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // FTS5 virtual table for full-text search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts
        USING fts5(id UNINDEXED, content)
      `);
    } catch {
      // FTS5 may not be available — degrade gracefully
    }

    // Migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  private loadVectorIndex(): void {
    try {
      const rows = this.db
        .prepare("SELECT id, embedding FROM documents WHERE embedding IS NOT NULL")
        .all() as Array<{ id: string; embedding: Buffer }>;

      this.vectorIndex = rows
        .filter((r) => r.embedding)
        .map((r) => ({
          id: r.id,
          vector: blobToVector(r.embedding),
        }));

      this.loaded = true;
    } catch {
      this.loaded = true;
    }
  }

  async upsert(
    id: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    // Generate embedding
    const vector = await embed(content);
    const embeddingBlob = vector ? vectorToBlob(vector) : null;

    const existing = this.db
      .prepare("SELECT id FROM documents WHERE id = ?")
      .get(id);

    if (existing) {
      this.db
        .prepare(
          "UPDATE documents SET content = ?, metadata = ?, embedding = ?, updated_at = ? WHERE id = ?",
        )
        .run(content, metaJson, embeddingBlob, now, id);

      // Update FTS
      this.deleteFts(id);
      this.insertFts(id, content);
    } else {
      this.db
        .prepare(
          "INSERT INTO documents (id, content, metadata, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, content, metaJson, embeddingBlob, now, now);

      this.insertFts(id, content);
    }

    // Update in-memory vector index
    if (vector) {
      const idx = this.vectorIndex.findIndex((e) => e.id === id);
      if (idx >= 0) {
        this.vectorIndex[idx].vector = vector;
      } else {
        this.vectorIndex.push({ id, vector });
      }
    }
  }

  async search(query: string, limit: number = 10): Promise<KnowledgeDocument[]> {
    // Hybrid search: FTS5 + vector + RRF
    const ftsIds = this.searchFts(query, limit);
    const vectorIds = await this.searchVectors(query, limit);

    // Reciprocal Rank Fusion
    const k = 60;
    const scores = new Map<string, number>();

    for (let i = 0; i < ftsIds.length; i++) {
      scores.set(ftsIds[i], (scores.get(ftsIds[i]) ?? 0) + 1 / (k + i + 1));
    }
    for (let i = 0; i < vectorIds.length; i++) {
      scores.set(vectorIds[i], (scores.get(vectorIds[i]) ?? 0) + 1 / (k + i + 1));
    }

    const rankedIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    // If no results from hybrid, fall back to LIKE
    const finalIds = rankedIds.length > 0 ? rankedIds : this.searchLike(query, limit);

    return finalIds
      .map((id) => this.get(id))
      .filter((doc): doc is KnowledgeDocument => doc !== null);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
    this.deleteFts(id);
    this.vectorIndex = this.vectorIndex.filter((e) => e.id !== id);
  }

  get(id: string): KnowledgeDocument | null {
    const row = this.db
      .prepare("SELECT id, content, metadata, created_at, updated_at FROM documents WHERE id = ?")
      .get(id) as
      | { id: string; content: string; metadata: string | null; created_at: string; updated_at: string }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  count(): number {
    const row = this.db
      .prepare("SELECT count(*) as c FROM documents")
      .get() as { c: number };
    return row.c;
  }

  close(): void {
    this.db.close();
  }

  // ─── FTS helpers ─────────────────────────────────────────────

  private hasFts: boolean | null = null;

  private checkFts(): boolean {
    if (this.hasFts !== null) return this.hasFts;
    try {
      this.db.prepare("SELECT count(*) FROM documents_fts LIMIT 1").get();
      this.hasFts = true;
    } catch {
      this.hasFts = false;
    }
    return this.hasFts;
  }

  private searchFts(query: string, limit: number): string[] {
    if (!this.checkFts()) return [];
    try {
      const sanitized = query
        .replace(/['"]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .map((w) => `"${w}"`)
        .join(" OR ");

      if (!sanitized) return [];

      const rows = this.db
        .prepare(
          `SELECT id, bm25(documents_fts) as rank
           FROM documents_fts
           WHERE documents_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(sanitized, limit) as Array<{ id: string; rank: number }>;

      return rows.map((r) => r.id);
    } catch {
      return [];
    }
  }

  private insertFts(id: string, content: string): void {
    if (!this.checkFts()) return;
    try {
      this.db
        .prepare("INSERT INTO documents_fts (id, content) VALUES (?, ?)")
        .run(id, content);
    } catch { /* ignore */ }
  }

  private deleteFts(id: string): void {
    if (!this.checkFts()) return;
    try {
      this.db
        .prepare("DELETE FROM documents_fts WHERE id = ?")
        .run(id);
    } catch { /* ignore */ }
  }

  // ─── Vector helpers ──────────────────────────────────────────

  private async searchVectors(query: string, topK: number): Promise<string[]> {
    if (!this.loaded || this.vectorIndex.length === 0) return [];

    const queryVec = await embed(query);
    if (!queryVec) return [];

    const scored = this.vectorIndex.map((entry) => ({
      id: entry.id,
      score: cosineSimilarity(queryVec, entry.vector),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.id);
  }

  // ─── LIKE fallback ───────────────────────────────────────────

  private searchLike(query: string, limit: number): string[] {
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 2);

    if (keywords.length === 0) return [];

    const conditions = keywords.map(() => "LOWER(content) LIKE ?").join(" OR ");
    const params = keywords.map((k) => `%${k}%`);

    const rows = this.db
      .prepare(
        `SELECT id FROM documents WHERE ${conditions} ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<{ id: string }>;

    return rows.map((r) => r.id);
  }
}
