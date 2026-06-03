import { eq } from "drizzle-orm";
import type { Credential, CredentialType, CredentialScope } from "@otterbot/shared";
import { controlSchema, type ControlDb } from "../db/control-db.js";
import type { GlobalSecretsStore } from "../secrets/global-secrets-store.js";
import { credentialKeysFor, getCredentialTypeDef } from "../integrations/connection-registry.js";

/** Namespace a credential's stored secret key in `global_secrets`. */
function secretKey(credId: string, key: string): string {
  return `cred:${credId}:${key}`;
}

const SECRET_PREFIX = (credId: string) => `cred:${credId}:`;

/** Mask a secret to a short, identifiable hint — e.g. `xoxb-…a1b2`. */
function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return `${v.slice(0, 2)}…`;
  return `${v.slice(0, 5)}…${v.slice(-4)}`;
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "credential"
  );
}

/**
 * Named, typed secret bundles. The `credentials` row holds only id/label/type;
 * the secret *values* live in `global_secrets` under `cred:<id>:<KEY>`, reusing
 * the existing encryption-at-rest and `scope` machinery. Values are never
 * returned to the API — only presence flags and masked hints.
 */
export class CredentialStore {
  constructor(
    private readonly control: ControlDb,
    private readonly globalSecrets: GlobalSecretsStore
  ) {}

  /** All credentials, masked (no secret values). */
  list(): Credential[] {
    const rows = this.control.db.select().from(controlSchema.credentials).all();
    return rows.map((r) => this.toMasked(r.id, r.type, r.label, r.config, r.createdAt, r.updatedAt));
  }

  /** One credential, masked. */
  get(id: string): Credential | null {
    const r = this.control.db
      .select()
      .from(controlSchema.credentials)
      .where(eq(controlSchema.credentials.id, id))
      .get();
    return r ? this.toMasked(r.id, r.type, r.label, r.config, r.createdAt, r.updatedAt) : null;
  }

  rawType(id: string): CredentialType | null {
    const r = this.control.db
      .select({ type: controlSchema.credentials.type })
      .from(controlSchema.credentials)
      .where(eq(controlSchema.credentials.id, id))
      .get();
    return r?.type ?? null;
  }

  /** Resolve a credential's secrets as an env-keyed map (for runtime use). */
  secretsFor(id: string): Map<string, string> {
    const prefix = SECRET_PREFIX(id);
    const out = new Map<string, string>();
    for (const [key, value] of this.globalSecrets.get()) {
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), value);
    }
    return out;
  }

  /** The scope each of a credential's keys carries (for runtime layering). */
  scopedSecretsFor(id: string): Map<string, { value: string; scope: CredentialScope }> {
    const prefix = SECRET_PREFIX(id);
    const out = new Map<string, { value: string; scope: CredentialScope }>();
    for (const [key, entry] of this.globalSecrets.getScoped()) {
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), entry);
    }
    return out;
  }

  create(input: {
    type: CredentialType;
    label: string;
    secrets: Record<string, string>;
    config?: Record<string, unknown>;
    id?: string;
  }): Credential {
    const def = getCredentialTypeDef(input.type);
    if (!def) throw new Error(`unknown credential type: ${input.type}`);
    const id = this.uniqueId(input.id ?? input.label ?? input.type);
    const now = new Date().toISOString();
    this.control.db
      .insert(controlSchema.credentials)
      .values({
        id,
        label: input.label || input.type,
        type: input.type,
        config: input.config ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.writeSecrets(id, input.type, input.secrets);
    return this.get(id)!;
  }

  /** Update label, non-secret config, and/or secrets. Blank/omitted secret values keep the stored one. */
  update(
    id: string,
    patch: { label?: string; config?: Record<string, unknown>; secrets?: Record<string, string> }
  ): Credential | null {
    const r = this.control.db
      .select()
      .from(controlSchema.credentials)
      .where(eq(controlSchema.credentials.id, id))
      .get();
    if (!r) return null;
    const sets: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.label !== undefined) sets.label = patch.label;
    if (patch.config !== undefined) sets.config = patch.config;
    this.control.db.update(controlSchema.credentials).set(sets).where(eq(controlSchema.credentials.id, id)).run();
    if (patch.secrets) this.writeSecrets(id, r.type, patch.secrets);
    return this.get(id);
  }

  /** Upsert one secret on a credential (e.g. a runtime-minted Matrix token). */
  upsertSecret(id: string, key: string, value: string, scope: CredentialScope = "direct"): void {
    this.globalSecrets.upsert(secretKey(id, key), value, scope);
  }

  delete(id: string): boolean {
    const prefix = SECRET_PREFIX(id);
    for (const key of this.globalSecrets.get().keys()) {
      if (key.startsWith(prefix)) this.globalSecrets.deleteOne(key);
    }
    const res = this.control.db
      .delete(controlSchema.credentials)
      .where(eq(controlSchema.credentials.id, id))
      .run();
    return res.changes > 0;
  }

  // --- internals ------------------------------------------------------------

  private writeSecrets(id: string, type: CredentialType, secrets: Record<string, string>): void {
    const def = getCredentialTypeDef(type);
    const scopeFor = new Map<string, CredentialScope>();
    for (const f of def?.fieldSchema.fields ?? []) {
      if (f.credentialKey) scopeFor.set(f.credentialKey, f.scope ?? "direct");
    }
    for (const [key, value] of Object.entries(secrets)) {
      // Blank value = keep existing (don't overwrite a stored secret with "").
      if (value === undefined || value === "") continue;
      this.globalSecrets.upsert(secretKey(id, key), value, scopeFor.get(key) ?? "direct");
    }
  }

  private toMasked(
    id: string,
    type: CredentialType,
    label: string,
    config: Record<string, unknown> | null,
    createdAt: string,
    updatedAt: string
  ): Credential {
    const stored = this.secretsFor(id);
    const fieldsPresent: Record<string, boolean> = {};
    const hints: Record<string, string> = {};
    for (const key of credentialKeysFor(type)) {
      const present = stored.has(key) && Boolean(stored.get(key));
      fieldsPresent[key] = present;
      if (present) hints[key] = mask(stored.get(key)!);
    }
    return { id, label, type, fieldsPresent, hints, config: config ?? {}, createdAt, updatedAt };
  }

  private uniqueId(base: string): string {
    const root = slugify(base);
    let id = root;
    let n = 2;
    const exists = (candidate: string) =>
      this.control.db
        .select({ id: controlSchema.credentials.id })
        .from(controlSchema.credentials)
        .where(eq(controlSchema.credentials.id, candidate))
        .get() !== undefined;
    while (exists(id)) id = `${root}-${n++}`;
    return id;
  }
}
