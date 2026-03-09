/**
 * GitHub account resolver — central module for resolving which GitHub account
 * to use for a given project context.
 *
 * Resolution chain: project-specific account → default account → legacy config fallback.
 */

import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { getConfig } from "../auth/auth.js";

export interface ResolvedGitHubAccount {
  id: string;
  label: string;
  token: string;
  username: string | null;
  email: string | null;
  sshKeyPath: string | null;
  sshFingerprint: string | null;
  sshKeyType: string | null;
  sshKeyUsage: string | null;
  isDefault: boolean;
}

/**
 * Resolve the GitHub account for a project.
 * Lookup chain: project's githubAccountId → default account → legacy config fallback.
 */
export function resolveGitHubAccount(projectId?: string): ResolvedGitHubAccount | null {
  const db = getDb();

  // 1. Project-specific account
  if (projectId) {
    const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    if (project?.githubAccountId) {
      const account = db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.id, project.githubAccountId)).get();
      if (account) return account;
    }
  }

  // 2. Default account
  const defaultAccount = db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.isDefault, true)).get();
  if (defaultAccount) return defaultAccount;

  // 3. First account (if only one exists)
  const allAccounts = db.select().from(schema.githubAccounts).all();
  if (allAccounts.length === 1) return allAccounts[0];

  // 4. Legacy config fallback
  const token = getConfig("github:token");
  if (token) {
    return {
      id: "__legacy__",
      label: "Legacy",
      token,
      username: getConfig("github:username") ?? null,
      email: getConfig("github:email") ?? null,
      sshKeyPath: null,
      sshFingerprint: null,
      sshKeyType: null,
      sshKeyUsage: null,
      isDefault: true,
    };
  }

  return null;
}

/** Convenience: resolve just the token for a project. */
export function resolveGitHubToken(projectId?: string): string | undefined {
  return resolveGitHubAccount(projectId)?.token;
}

/** Convenience: resolve just the username for a project. */
export function resolveGitHubUsername(projectId?: string): string | undefined {
  return resolveGitHubAccount(projectId)?.username ?? undefined;
}

/** Convenience: resolve just the email for a project. */
export function resolveGitHubEmail(projectId?: string): string | undefined {
  return resolveGitHubAccount(projectId)?.email ?? undefined;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getGitHubAccounts(): (typeof schema.githubAccounts.$inferSelect)[] {
  return getDb().select().from(schema.githubAccounts).all();
}

export function getGitHubAccountById(id: string): typeof schema.githubAccounts.$inferSelect | undefined {
  return getDb().select().from(schema.githubAccounts).where(eq(schema.githubAccounts.id, id)).get();
}

export function getDefaultGitHubAccount(): typeof schema.githubAccounts.$inferSelect | undefined {
  return getDb().select().from(schema.githubAccounts).where(eq(schema.githubAccounts.isDefault, true)).get();
}

export function createGitHubAccount(data: {
  id: string;
  label: string;
  token: string;
  email?: string;
  isDefault?: boolean;
}): typeof schema.githubAccounts.$inferSelect {
  const db = getDb();
  const now = new Date().toISOString();

  // If this is the default (or the first account), enforce single-default invariant
  const existingAccounts = db.select().from(schema.githubAccounts).all();
  const shouldBeDefault = data.isDefault || existingAccounts.length === 0;

  if (shouldBeDefault) {
    db.update(schema.githubAccounts).set({ isDefault: false, updatedAt: now }).run();
  }

  db.insert(schema.githubAccounts)
    .values({
      id: data.id,
      label: data.label,
      token: data.token,
      email: data.email ?? null,
      isDefault: shouldBeDefault,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db.select().from(schema.githubAccounts).where(eq(schema.githubAccounts.id, data.id)).get()!;
}

export function updateGitHubAccount(
  id: string,
  data: { label?: string; token?: string; email?: string; username?: string },
): void {
  const db = getDb();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.label !== undefined) updates.label = data.label;
  if (data.token !== undefined) updates.token = data.token;
  if (data.email !== undefined) updates.email = data.email;
  if (data.username !== undefined) updates.username = data.username;

  db.update(schema.githubAccounts).set(updates).where(eq(schema.githubAccounts.id, id)).run();
}

export function deleteGitHubAccount(id: string): { ok: boolean; error?: string } {
  const db = getDb();

  // Check if any projects are bound to this account
  const boundProjects = db.select().from(schema.projects).all().filter((p) => p.githubAccountId === id);
  if (boundProjects.length > 0) {
    const names = boundProjects.map((p) => p.name).join(", ");
    return { ok: false, error: `Account is used by project(s): ${names}. Reassign them first.` };
  }

  db.delete(schema.githubAccounts).where(eq(schema.githubAccounts.id, id)).run();
  return { ok: true };
}

export function setDefaultGitHubAccount(id: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.update(schema.githubAccounts).set({ isDefault: false, updatedAt: now }).run();
  db.update(schema.githubAccounts).set({ isDefault: true, updatedAt: now }).where(eq(schema.githubAccounts.id, id)).run();
}
