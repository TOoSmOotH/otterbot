import { eq } from "drizzle-orm";
import type { CredentialScope } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import type { ScopedSecret } from "./secrets-store.js";

/** Default scope applied when none was given. */
const DEFAULT_SCOPE: CredentialScope = "broad";

/**
 * Instance-wide credential store, backed by the (encrypted) control database —
 * the global counterpart of {@link SecretsStore}. There is no `agentId`
 * dimension: every agent shares these credentials. They are layered *beneath*
 * an agent's own secrets at context-build time (see
 * `Orchestrator.buildScopedSecrets`), so a per-agent key of the same name still
 * wins. The same `scope` exposure rules apply (`direct` / `broad` / `cap:<id>`).
 */
export class GlobalSecretsStore {
  constructor(private readonly control: ControlDb) {}

  /** All global secrets as a key/value map — values only, no scope. */
  get(): Map<string, string> {
    const rows = this.control.db.select().from(controlSchema.globalSecrets).all();
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /** All global secrets as `key -> { value, scope }`. */
  getScoped(): Map<string, ScopedSecret> {
    const rows = this.control.db.select().from(controlSchema.globalSecrets).all();
    return new Map(
      rows.map((r) => [r.key, { value: r.value, scope: (r.scope || DEFAULT_SCOPE) as CredentialScope }])
    );
  }

  /** List `(key, scope)` pairs — used by the API to render the UI without leaking values. */
  listScopes(): Array<{ key: string; scope: CredentialScope }> {
    const rows = this.control.db
      .select({ key: controlSchema.globalSecrets.key, scope: controlSchema.globalSecrets.scope })
      .from(controlSchema.globalSecrets)
      .all();
    return rows.map((r) => ({ key: r.key, scope: (r.scope || DEFAULT_SCOPE) as CredentialScope }));
  }

  /**
   * Upsert a single global secret without touching the rest. If `scope` is
   * omitted and the row already exists, the existing scope is preserved; for a
   * new row, `broad` is used.
   */
  upsert(key: string, value: string, scope?: CredentialScope): void {
    const k = key.trim();
    if (!k) return;
    const existing = this.control.db
      .select({ scope: controlSchema.globalSecrets.scope })
      .from(controlSchema.globalSecrets)
      .where(eq(controlSchema.globalSecrets.key, k))
      .get();
    const effective = scope ?? (existing?.scope as CredentialScope | undefined) ?? DEFAULT_SCOPE;
    if (existing) {
      this.control.db
        .update(controlSchema.globalSecrets)
        .set({ value, scope: effective })
        .where(eq(controlSchema.globalSecrets.key, k))
        .run();
    } else {
      this.control.db
        .insert(controlSchema.globalSecrets)
        .values({ key: k, value, scope: effective })
        .run();
    }
  }

  /** Change scope for an existing key without resending the value. */
  setScope(key: string, scope: CredentialScope): boolean {
    const res = this.control.db
      .update(controlSchema.globalSecrets)
      .set({ scope })
      .where(eq(controlSchema.globalSecrets.key, key.trim()))
      .run();
    return res.changes > 0;
  }

  /** Delete a single global secret by key. */
  deleteOne(key: string): void {
    this.control.db
      .delete(controlSchema.globalSecrets)
      .where(eq(controlSchema.globalSecrets.key, key.trim()))
      .run();
  }
}
