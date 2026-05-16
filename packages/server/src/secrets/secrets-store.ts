import { eq } from "drizzle-orm";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/**
 * Per-agent credential store, backed by the (encrypted) control database.
 * Replaces plaintext `.env` files in profile directories — the only secret
 * outside the database is now the database encryption key itself.
 */
export class SecretsStore {
  constructor(private readonly control: ControlDb) {}

  /** All secrets for an agent as a key/value map. */
  get(agentId: string): Map<string, string> {
    const rows = this.control.db
      .select()
      .from(controlSchema.agentSecrets)
      .where(eq(controlSchema.agentSecrets.agentId, agentId))
      .all();
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /** Replace all of an agent's secrets in one transaction. */
  set(agentId: string, secrets: Map<string, string> | Record<string, string>): void {
    const entries = secrets instanceof Map ? [...secrets] : Object.entries(secrets);
    const apply = this.control.sqlite.transaction(() => {
      this.control.db
        .delete(controlSchema.agentSecrets)
        .where(eq(controlSchema.agentSecrets.agentId, agentId))
        .run();
      for (const [key, value] of entries) {
        if (!key.trim()) continue;
        this.control.db
          .insert(controlSchema.agentSecrets)
          .values({ agentId, key: key.trim(), value })
          .run();
      }
    });
    apply();
  }

  /** Delete every secret belonging to an agent. */
  delete(agentId: string): void {
    this.control.db
      .delete(controlSchema.agentSecrets)
      .where(eq(controlSchema.agentSecrets.agentId, agentId))
      .run();
  }

  /** Whether an agent has any secrets stored. */
  hasAny(agentId: string): boolean {
    return (
      this.control.db
        .select()
        .from(controlSchema.agentSecrets)
        .where(eq(controlSchema.agentSecrets.agentId, agentId))
        .all().length > 0
    );
  }
}
