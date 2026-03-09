/**
 * Gitea account resolver — central module for resolving which Gitea account
 * to use for a given project context.
 *
 * Resolution chain: project-specific account → default account → legacy config fallback.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";

export interface ResolvedGiteaAccount {
  id: string;
  label: string;
  token: string;
  username: string | null;
  email: string | null;
  instanceUrl: string;
  isDefault: boolean;
}

/**
 * Resolve the Gitea account for a project.
 * Lookup chain: project's giteaAccountId → default account → legacy config fallback.
 */
export function resolveGiteaAccount(projectId?: string): ResolvedGiteaAccount | null {
  const db = getDb();

  // 1. Project-specific account
  if (projectId) {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (project?.giteaAccountId) {
      const account = db.select().from(schema.giteaAccounts).where(eq(schema.giteaAccounts.id, project.giteaAccountId)).get();
      if (account) return account;
    }
  }

  // 2. Default account
  const defaultAccount = db.select().from(schema.giteaAccounts).where(eq(schema.giteaAccounts.isDefault, true)).get();
  if (defaultAccount) return defaultAccount;

  // 3. First account (if only one exists)
  const allAccounts = db.select().from(schema.giteaAccounts).all();
  if (allAccounts.length === 1) return allAccounts[0];

  // 4. Legacy config fallback
  const token = getConfig("gitea:token");
  const instanceUrl = getConfig("gitea:instance_url");
  if (token && instanceUrl) {
    return {
      id: "__legacy__",
      label: "Legacy",
      token,
      username: getConfig("gitea:username") ?? null,
      email: getConfig("gitea:email") ?? null,
      instanceUrl,
      isDefault: true,
    };
  }

  return null;
}

/** Convenience: resolve just the token for a project. */
export function resolveGiteaToken(projectId?: string): string | undefined {
  return resolveGiteaAccount(projectId)?.token;
}

/** Convenience: resolve just the username for a project. */
export function resolveGiteaUsername(projectId?: string): string | undefined {
  return resolveGiteaAccount(projectId)?.username ?? undefined;
}

/** Convenience: resolve just the email for a project. */
export function resolveGiteaEmail(projectId?: string): string | undefined {
  return resolveGiteaAccount(projectId)?.email ?? undefined;
}

/** Convenience: resolve the instance URL for a project. */
export function resolveGiteaInstanceUrl(projectId?: string): string | undefined {
  return resolveGiteaAccount(projectId)?.instanceUrl;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getGiteaAccounts(): (typeof schema.giteaAccounts.$inferSelect)[] {
  return getDb().select().from(schema.giteaAccounts).all();
}

export function getGiteaAccountById(id: string): typeof schema.giteaAccounts.$inferSelect | undefined {
  return getDb().select().from(schema.giteaAccounts).where(eq(schema.giteaAccounts.id, id)).get();
}

export function getDefaultGiteaAccount(): typeof schema.giteaAccounts.$inferSelect | undefined {
  return getDb().select().from(schema.giteaAccounts).where(eq(schema.giteaAccounts.isDefault, true)).get();
}

export function createGiteaAccount(data: {
  id: string;
  label: string;
  token: string;
  instanceUrl: string;
  username?: string;
  email?: string;
  isDefault?: boolean;
}): typeof schema.giteaAccounts.$inferSelect {
  const db = getDb();
  const now = new Date().toISOString();

  // If this is the default (or the first account), enforce single-default invariant
  const existingAccounts = db.select().from(schema.giteaAccounts).all();
  const shouldBeDefault = data.isDefault || existingAccounts.length === 0;

  if (shouldBeDefault) {
    db.update(schema.giteaAccounts).set({ isDefault: false, updatedAt: now }).run();
  }

  db.insert(schema.giteaAccounts)
    .values({
      id: data.id,
      label: data.label,
      token: data.token,
      instanceUrl: data.instanceUrl,
      username: data.username ?? null,
      email: data.email ?? null,
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(schema.giteaAccounts).where(eq(schema.giteaAccounts.id, data.id)).get()!;
}

export function updateGiteaAccount(
  id: string,
  data: { label?: string; token?: string; instanceUrl?: string; email?: string; username?: string },
): void {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.label !== undefined) updates.label = data.label;
  if (data.token !== undefined) updates.token = data.token;
  if (data.instanceUrl !== undefined) updates.instanceUrl = data.instanceUrl;
  if (data.email !== undefined) updates.email = data.email;
  if (data.username !== undefined) updates.username = data.username;

  db.update(schema.giteaAccounts).set(updates).where(eq(schema.giteaAccounts.id, id)).run();
}

export function deleteGiteaAccount(id: string): { ok: boolean; error?: string } {
  const db = getDb();

  // Check if any projects are bound to this account
  const boundProjects = db.select().from(schema.projects).all().filter((p) => p.giteaAccountId === id);
  if (boundProjects.length > 0) {
    const names = boundProjects.map((p) => p.name).join(", ");
    return { ok: false, error: `Account is used by project(s): ${names}. Reassign them first.` };
  }

  db.delete(schema.giteaAccounts).where(eq(schema.giteaAccounts.id, id)).run();
  return { ok: true };
}

export function setDefaultGiteaAccount(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(schema.giteaAccounts).set({ isDefault: false, updatedAt: now }).run();
  db.update(schema.giteaAccounts).set({ isDefault: true, updatedAt: now }).where(eq(schema.giteaAccounts.id, id)).run();
}
