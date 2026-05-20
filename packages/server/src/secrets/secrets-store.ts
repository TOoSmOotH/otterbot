import { and, eq } from "drizzle-orm";
import type { CredentialScope } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/** A credential with its exposure rule attached. */
export interface ScopedSecret {
  value: string;
  scope: CredentialScope;
}

/** Default scope applied when none was given (e.g. legacy callers). */
const DEFAULT_SCOPE: CredentialScope = "broad";

/**
 * Per-agent credential store, backed by the (encrypted) control database.
 * Replaces plaintext `.env` files in profile directories — the only secret
 * outside the database is now the database encryption key itself.
 *
 * Each credential carries a `scope` field — see `CredentialScope` — that
 * decides whether the value is reachable through the agent's shell env or
 * only through direct integrations.
 */
export class SecretsStore {
  constructor(private readonly control: ControlDb) {}

  /** All secrets for an agent as a key/value map — values only, no scope. */
  get(agentId: string): Map<string, string> {
    const rows = this.control.db
      .select()
      .from(controlSchema.agentSecrets)
      .where(eq(controlSchema.agentSecrets.agentId, agentId))
      .all();
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /** All secrets for an agent as `key -> { value, scope }`. */
  getScoped(agentId: string): Map<string, ScopedSecret> {
    const rows = this.control.db
      .select()
      .from(controlSchema.agentSecrets)
      .where(eq(controlSchema.agentSecrets.agentId, agentId))
      .all();
    return new Map(
      rows.map((r) => [r.key, { value: r.value, scope: (r.scope || DEFAULT_SCOPE) as CredentialScope }])
    );
  }

  /** List `(key, scope)` pairs — used by the API to render the UI without leaking values. */
  listScopes(agentId: string): Array<{ key: string; scope: CredentialScope }> {
    const rows = this.control.db
      .select({ key: controlSchema.agentSecrets.key, scope: controlSchema.agentSecrets.scope })
      .from(controlSchema.agentSecrets)
      .where(eq(controlSchema.agentSecrets.agentId, agentId))
      .all();
    return rows.map((r) => ({
      key: r.key,
      scope: (r.scope || DEFAULT_SCOPE) as CredentialScope,
    }));
  }

  /**
   * Replace all of an agent's secrets in one transaction. Accepts a legacy
   * `Record<string,string>` (scope defaults to `broad`) or a structured map
   * carrying scope per entry.
   */
  set(
    agentId: string,
    secrets:
      | Map<string, string>
      | Map<string, ScopedSecret>
      | Record<string, string | ScopedSecret>,
  ): void {
    const entries = this.normaliseEntries(secrets);
    const apply = this.control.sqlite.transaction(() => {
      this.control.db
        .delete(controlSchema.agentSecrets)
        .where(eq(controlSchema.agentSecrets.agentId, agentId))
        .run();
      for (const [key, entry] of entries) {
        if (!key.trim()) continue;
        this.control.db
          .insert(controlSchema.agentSecrets)
          .values({ agentId, key: key.trim(), value: entry.value, scope: entry.scope })
          .run();
      }
    });
    apply();
  }

  /**
   * Upsert a single secret without touching the rest. If `scope` is omitted
   * and the row already exists, the existing scope is preserved; if it's a
   * new row, `broad` is used.
   */
  upsert(
    agentId: string,
    key: string,
    value: string,
    scope?: CredentialScope,
  ): void {
    const k = key.trim();
    if (!k) return;
    const existing = this.control.db
      .select({ scope: controlSchema.agentSecrets.scope })
      .from(controlSchema.agentSecrets)
      .where(
        and(
          eq(controlSchema.agentSecrets.agentId, agentId),
          eq(controlSchema.agentSecrets.key, k),
        ),
      )
      .get();
    const effective = scope ?? (existing?.scope as CredentialScope | undefined) ?? DEFAULT_SCOPE;
    if (existing) {
      this.control.db
        .update(controlSchema.agentSecrets)
        .set({ value, scope: effective })
        .where(
          and(
            eq(controlSchema.agentSecrets.agentId, agentId),
            eq(controlSchema.agentSecrets.key, k),
          ),
        )
        .run();
    } else {
      this.control.db
        .insert(controlSchema.agentSecrets)
        .values({ agentId, key: k, value, scope: effective })
        .run();
    }
  }

  /** Change scope for an existing key without resending the value. */
  setScope(agentId: string, key: string, scope: CredentialScope): boolean {
    const res = this.control.db
      .update(controlSchema.agentSecrets)
      .set({ scope })
      .where(
        and(
          eq(controlSchema.agentSecrets.agentId, agentId),
          eq(controlSchema.agentSecrets.key, key.trim()),
        ),
      )
      .run();
    return res.changes > 0;
  }

  /** Delete a single secret by key, leaving the agent's other secrets intact. */
  deleteOne(agentId: string, key: string): void {
    this.control.db
      .delete(controlSchema.agentSecrets)
      .where(
        and(
          eq(controlSchema.agentSecrets.agentId, agentId),
          eq(controlSchema.agentSecrets.key, key.trim())
        )
      )
      .run();
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

  private normaliseEntries(
    secrets:
      | Map<string, string>
      | Map<string, ScopedSecret>
      | Record<string, string | ScopedSecret>,
  ): Array<[string, ScopedSecret]> {
    const raw: Iterable<[string, string | ScopedSecret]> =
      secrets instanceof Map ? secrets : Object.entries(secrets);
    const out: Array<[string, ScopedSecret]> = [];
    for (const [key, entry] of raw) {
      if (typeof entry === "string") {
        out.push([key, { value: entry, scope: DEFAULT_SCOPE }]);
      } else {
        out.push([key, { value: entry.value, scope: entry.scope ?? DEFAULT_SCOPE }]);
      }
    }
    return out;
  }
}
