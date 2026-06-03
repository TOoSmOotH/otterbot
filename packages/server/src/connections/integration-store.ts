import type { Account, Binding } from "@otterbot/shared";
import type { CredentialStore } from "./credential-store.js";
import type { ConnectionStore } from "./connection-store.js";

/**
 * Unified facade over the two-tier Integrations model:
 *
 * - **Accounts** — the reusable identity + secret (the `credentials` table,
 *   {@link CredentialStore}). One account can back many bindings.
 * - **Bindings** — one use of an account + who it's for (the `connections` +
 *   `connection_assignments` tables, {@link ConnectionStore}). A binding targets
 *   specific agents, or every agent via `allAgents`.
 *
 * The Settings → Integrations UI and `/api/integrations` talk to this one object
 * instead of reaching into two stores. The unified vocabulary (account/binding)
 * is exposed here; the underlying stores keep their existing names during the
 * transition. Cross-cutting operations that need both stores (the in-use guard,
 * per-agent binding resolution) live here.
 */
export class IntegrationStore {
  constructor(
    readonly accounts: CredentialStore,
    readonly bindings: ConnectionStore
  ) {}

  // --- combined views -------------------------------------------------------

  /** Bindings that reference a given account (its "in use by" set). */
  bindingsUsingAccount(accountId: string): Binding[] {
    return this.bindings.list().filter((b) => b.credentialId === accountId);
  }

  /**
   * Every binding that applies to an agent: those explicitly assigned to it plus
   * every instance-wide (`allAgents`) binding. De-duplicated by binding id.
   */
  bindingsForAgent(agentId: string): Binding[] {
    const byId = new Map<string, Binding>();
    for (const b of this.bindings.connectionsForAgent(agentId)) byId.set(b.id, b);
    for (const b of this.bindings.list()) if (b.allAgents) byId.set(b.id, b);
    return [...byId.values()];
  }

  /**
   * Delete an account. Refuses while bindings still reference it unless `force`,
   * in which case those bindings are detached (their `credentialId` is nulled)
   * first. Mirrors the connection delete guard.
   */
  deleteAccount(id: string, opts: { force?: boolean } = {}): { ok: boolean; error?: string } {
    const inUse = this.bindingsUsingAccount(id);
    if (inUse.length && !opts.force) {
      const names = inUse.map((b) => b.label).join(", ");
      return { ok: false, error: `Account is used by ${inUse.length} integration(s): ${names}.` };
    }
    for (const b of inUse) this.bindings.update(b.id, { credentialId: null });
    return { ok: this.accounts.delete(id) };
  }

  // --- thin pass-throughs (unified names) -----------------------------------

  listAccounts(): Account[] {
    return this.accounts.list();
  }
  getAccount(id: string): Account | null {
    return this.accounts.get(id);
  }
  listBindings(): Binding[] {
    return this.bindings.list();
  }
  getBinding(id: string): Binding | null {
    return this.bindings.get(id);
  }
}
