import { nanoid } from "nanoid";
import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import type { SoulDocument } from "@otterbot/shared";

/**
 * Service for managing soul documents — markdown personality definitions
 * that get injected into agent system prompts.
 *
 * Resolution order (most specific wins):
 * 1. Registry-entry-specific soul (e.g., "builtin-coder" has its own soul)
 * 2. Role-level soul (e.g., all workers share a soul)
 * 3. Global soul (fallback for any agent without a more specific one)
 */
export class SoulService {
  /** Get a soul document by exact match (role + registryEntryId) */
  get(agentRole: string, registryEntryId?: string | null): SoulDocument | null {
    const db = getDb();
    const condition = registryEntryId
      ? and(
          eq(schema.soulDocuments.agentRole, agentRole),
          eq(schema.soulDocuments.registryEntryId, registryEntryId),
        )
      : and(
          eq(schema.soulDocuments.agentRole, agentRole),
          isNull(schema.soulDocuments.registryEntryId),
        );

    const row = db.select().from(schema.soulDocuments).where(condition).get();
    return row ? this.toSoulDocument(row) : null;
  }

  /**
   * Resolve the best-match soul document for an agent.
   * Tries registry-entry-specific, then role-level, then global.
   */
  resolve(agentRole: string, registryEntryId?: string | null): string | null {
    // 1. Registry-entry-specific
    if (registryEntryId) {
      const specific = this.get(agentRole, registryEntryId);
      if (specific) return specific.content;
    }

    // 2. Role-level
    const roleLevel = this.get(agentRole);
    if (roleLevel) return roleLevel.content;

    // 3. Global fallback
    if (agentRole !== "global") {
      const global = this.get("global");
      if (global) return global.content;
    }

    return null;
  }

  /** Create or update a soul document */
  save(agentRole: string, registryEntryId: string | null, content: string): SoulDocument {
    const db = getDb();
    const now = new Date().toISOString();

    // Check if one already exists
    const existing = this.get(agentRole, registryEntryId);

    if (existing) {
      db.update(schema.soulDocuments)
        .set({ content, updatedAt: now })
        .where(eq(schema.soulDocuments.id, existing.id))
        .run();
      return { ...existing, content, updatedAt: now };
    }

    const id = nanoid();
    db.insert(schema.soulDocuments)
      .values({
        id,
        agentRole,
        registryEntryId,
        content,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id,
      agentRole,
      registryEntryId,
      content,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Delete a soul document by ID */
  delete(id: string): boolean {
    const db = getDb();
    const result = db.delete(schema.soulDocuments)
      .where(eq(schema.soulDocuments.id, id))
      .run();
    return result.changes > 0;
  }

  /** List all soul documents */
  list(): SoulDocument[] {
    const db = getDb();
    const rows = db.select().from(schema.soulDocuments).all();
    return rows.map((r) => this.toSoulDocument(r));
  }

  private toSoulDocument(row: typeof schema.soulDocuments.$inferSelect): SoulDocument {
    return {
      id: row.id,
      agentRole: row.agentRole,
      registryEntryId: row.registryEntryId,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
