import { credentialKeysFor } from "../integrations/connection-registry.js";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import type { CredentialStore } from "./credential-store.js";
import type { IntegrationStore } from "./integration-store.js";

/**
 * Capability types that used to be configured as bare instance-wide
 * `global_secrets` keys (e.g. `PROXMOX_HOST`) via the legacy capability-config
 * UI, and are now unified onto the account + binding model. Both are
 * instance-wide, so each migrates to one account plus one `allAgents` binding.
 */
const LEGACY_CAPABILITY_TYPES = ["proxmox", "ssh"] as const;

/**
 * One-time, idempotent migration of the duplicate Proxmox/SSH storage path.
 *
 * The old path stored each capability's fields as bare `global_secrets` keys
 * (instance-wide, injected into every agent). The unified path stores them as a
 * named account (`cred:<id>:<KEY>`) referenced by an `allAgents` binding. This
 * folds any surviving bare keys into the unified model and deletes them, so a
 * key resolves from exactly one place.
 *
 * Idempotent: once the bare keys are gone the function is a no-op.
 */
export function migrateLegacyCapabilities(
  integrations: IntegrationStore,
  globalSecrets: GlobalSecretsStore
): void {
  const bare = globalSecrets.get();
  for (const type of LEGACY_CAPABILITY_TYPES) {
    const keys = credentialKeysFor(type);
    const present = keys.filter((k) => bare.has(k) && bare.get(k) !== "");
    if (present.length === 0) continue;

    // Reuse an existing account of this type if the user already created one via
    // the newer path; otherwise mint one from the legacy values.
    let account = integrations.listAccounts().find((a) => a.type === type) ?? null;
    if (!account) {
      const secrets: Record<string, string> = {};
      for (const k of present) secrets[k] = bare.get(k)!;
      account = integrations.accounts.create({ type, label: type === "proxmox" ? "Proxmox" : "SSH", secrets });
      console.warn(`[integrations] migrated legacy ${type} config → account ${account.id} (instance-wide)`);
    }

    // Ensure exactly one instance-wide binding references the account.
    const hasBinding = integrations
      .bindingsUsingAccount(account.id)
      .some((b) => b.type === type && b.allAgents);
    if (!hasBinding) {
      integrations.bindings.create({
        type,
        label: account.label,
        credentialId: account.id,
        allAgents: true,
      });
    }

    // Drop the now-duplicate bare keys (and the derived allowlist key, if any).
    for (const k of keys) if (bare.has(k)) globalSecrets.deleteOne(k);
  }
}

/**
 * One-time, idempotent migration of forge accounts + reusable SSH keys into the
 * unified `credentials` (account) table. **Ids are preserved** so existing
 * references — `project_repos.forgeAccountId`, `projects.forgeAccountId`, and a
 * git account's `config.sshKeyId` → ssh-key account id — keep resolving without
 * rewriting. Non-secret fields move to the account `config`; the API token and
 * the PEM private key become `cred:<id>:<KEY>` secrets.
 *
 * Idempotent: an account whose id already exists in `credentials` is skipped, so
 * re-running (or running after the legacy tables are dropped) is a no-op.
 */
export function migrateForgeAndSshKeysToAccounts(control: ControlDb, credentials: CredentialStore): void {
  const globalSecrets = new GlobalSecretsStore(control);
  const exists = (id: string) => credentials.get(id) !== null;
  const now = new Date().toISOString();

  // forge_accounts → `git` accounts (token → cred:<id>:FORGE_TOKEN).
  for (const r of control.db.select().from(controlSchema.forgeAccounts).all()) {
    if (exists(r.id)) continue;
    control.db
      .insert(controlSchema.credentials)
      .values({
        id: r.id,
        label: r.label,
        type: "git",
        config: {
          provider: r.provider,
          baseUrl: r.baseUrl,
          username: r.username,
          gitTransport: r.gitTransport,
          committerName: r.committerName,
          committerEmail: r.committerEmail,
          signCommits: Boolean(r.signCommits),
          sshKeyId: r.sshKeyId ?? null,
        },
        createdAt: r.createdAt ?? now,
        updatedAt: now,
      })
      .run();
    if (r.token) globalSecrets.upsert(`cred:${r.id}:FORGE_TOKEN`, r.token, "cap:gh-auth");
    console.warn(`[integrations] migrated forge account ${r.id} → git account`);
  }

  // ssh_keys → `ssh-key` accounts (privateKey → cred:<id>:SSH_PRIVATE_KEY).
  for (const r of control.db.select().from(controlSchema.sshKeys).all()) {
    if (exists(r.id)) continue;
    control.db
      .insert(controlSchema.credentials)
      .values({
        id: r.id,
        label: r.label,
        type: "ssh-key",
        config: { publicKey: r.publicKey, fingerprint: r.fingerprint },
        createdAt: r.createdAt ?? now,
        updatedAt: now,
      })
      .run();
    if (r.privateKey) globalSecrets.upsert(`cred:${r.id}:SSH_PRIVATE_KEY`, r.privateKey, "direct");
    console.warn(`[integrations] migrated ssh key ${r.id} → ssh-key account`);
  }
}
