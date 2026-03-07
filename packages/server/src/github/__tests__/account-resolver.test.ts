import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { nanoid } from "nanoid";

// Mock auth
const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

import {
  resolveGitHubAccount,
  resolveGitHubToken,
  resolveGitHubUsername,
  getGitHubAccounts,
  getGitHubAccountById,
  createGitHubAccount,
  updateGitHubAccount,
  deleteGitHubAccount,
  setDefaultGitHubAccount,
  getDefaultGitHubAccount,
} from "../account-resolver.js";

describe("account-resolver", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-acct-test-"));
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key-123";
    resetDb();
    await migrateDb();
    configStore.clear();
  });

  afterEach(() => {
    resetDb();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("CRUD", () => {
    it("creates an account and retrieves it", () => {
      const account = createGitHubAccount({
        id: "acct-1",
        label: "Personal",
        token: "ghp_test123",
        email: "user@example.com",
      });

      expect(account.label).toBe("Personal");
      expect(account.token).toBe("ghp_test123");
      expect(account.isDefault).toBe(true); // first account is auto-default

      const retrieved = getGitHubAccountById("acct-1");
      expect(retrieved?.label).toBe("Personal");
    });

    it("first account is auto-default", () => {
      createGitHubAccount({ id: "acct-1", label: "First", token: "ghp_1" });
      createGitHubAccount({ id: "acct-2", label: "Second", token: "ghp_2" });

      const acct1 = getGitHubAccountById("acct-1");
      const acct2 = getGitHubAccountById("acct-2");
      // Second account is not default since first already is
      expect(acct1?.isDefault).toBe(true);
      expect(acct2?.isDefault).toBe(false);
    });

    it("sets default account and unsets others", () => {
      createGitHubAccount({ id: "acct-1", label: "First", token: "ghp_1" });
      createGitHubAccount({ id: "acct-2", label: "Second", token: "ghp_2" });

      setDefaultGitHubAccount("acct-2");

      expect(getGitHubAccountById("acct-1")?.isDefault).toBe(false);
      expect(getGitHubAccountById("acct-2")?.isDefault).toBe(true);
    });

    it("updates account fields", () => {
      createGitHubAccount({ id: "acct-1", label: "Old", token: "ghp_old" });
      updateGitHubAccount("acct-1", { label: "New", token: "ghp_new" });

      const acct = getGitHubAccountById("acct-1");
      expect(acct?.label).toBe("New");
      expect(acct?.token).toBe("ghp_new");
    });

    it("deletes account if no projects bound", () => {
      createGitHubAccount({ id: "acct-1", label: "Test", token: "ghp_1" });
      const result = deleteGitHubAccount("acct-1");
      expect(result.ok).toBe(true);
      expect(getGitHubAccounts()).toHaveLength(0);
    });

    it("refuses to delete account bound to a project", () => {
      createGitHubAccount({ id: "acct-1", label: "Test", token: "ghp_1" });
      const db = getDb();
      db.insert(schema.projects).values({
        id: "proj-1",
        name: "Test Project",
        description: "",
        status: "active",
        githubAccountId: "acct-1",
        rules: [],
        createdAt: new Date().toISOString(),
      }).run();

      const result = deleteGitHubAccount("acct-1");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Test Project");
    });

    it("lists all accounts", () => {
      createGitHubAccount({ id: "acct-1", label: "A", token: "ghp_1" });
      createGitHubAccount({ id: "acct-2", label: "B", token: "ghp_2" });
      expect(getGitHubAccounts()).toHaveLength(2);
    });
  });

  describe("resolution", () => {
    it("resolves default account when no project specified", () => {
      createGitHubAccount({ id: "acct-1", label: "Default", token: "ghp_default" });
      const account = resolveGitHubAccount();
      expect(account?.token).toBe("ghp_default");
    });

    it("resolves project-specific account", () => {
      createGitHubAccount({ id: "acct-1", label: "Default", token: "ghp_default" });
      createGitHubAccount({ id: "acct-2", label: "Work", token: "ghp_work" });

      const db = getDb();
      db.insert(schema.projects).values({
        id: "proj-1",
        name: "Work Project",
        description: "",
        status: "active",
        githubAccountId: "acct-2",
        rules: [],
        createdAt: new Date().toISOString(),
      }).run();

      const account = resolveGitHubAccount("proj-1");
      expect(account?.token).toBe("ghp_work");
      expect(account?.label).toBe("Work");
    });

    it("falls back to default when project has no account", () => {
      createGitHubAccount({ id: "acct-1", label: "Default", token: "ghp_default" });

      const db = getDb();
      db.insert(schema.projects).values({
        id: "proj-1",
        name: "No Account",
        description: "",
        status: "active",
        rules: [],
        createdAt: new Date().toISOString(),
      }).run();

      const account = resolveGitHubAccount("proj-1");
      expect(account?.token).toBe("ghp_default");
    });

    it("falls back to legacy config when no accounts exist", () => {
      configStore.set("github:token", "ghp_legacy");
      configStore.set("github:username", "legacyuser");

      const account = resolveGitHubAccount();
      expect(account?.token).toBe("ghp_legacy");
      expect(account?.username).toBe("legacyuser");
      expect(account?.id).toBe("__legacy__");
    });

    it("returns null when nothing configured", () => {
      expect(resolveGitHubAccount()).toBeNull();
      expect(resolveGitHubToken()).toBeUndefined();
      expect(resolveGitHubUsername()).toBeUndefined();
    });

    it("resolveGitHubToken convenience works", () => {
      createGitHubAccount({ id: "acct-1", label: "Test", token: "ghp_test" });
      expect(resolveGitHubToken()).toBe("ghp_test");
    });

    it("resolveGitHubUsername convenience works", () => {
      createGitHubAccount({ id: "acct-1", label: "Test", token: "ghp_test" });
      updateGitHubAccount("acct-1", { username: "testuser" });
      expect(resolveGitHubUsername()).toBe("testuser");
    });
  });
});
