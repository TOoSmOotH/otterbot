import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../db/index.js";

const configStore = new Map<string, string>();
vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

import {
  resolveGiteaAccount,
  resolveGiteaToken,
  resolveGiteaUsername,
  resolveGiteaEmail,
  resolveGiteaInstanceUrl,
  getGiteaAccounts,
  getGiteaAccountById,
  createGiteaAccount,
  updateGiteaAccount,
  deleteGiteaAccount,
  setDefaultGiteaAccount,
  getDefaultGiteaAccount,
} from "./account-resolver.js";

describe("gitea/account-resolver", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gitea-acct-test-"));
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key-123";
    resetDb();
    await migrateDb();
    configStore.clear();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates and retrieves a Gitea account", () => {
    const account = createGiteaAccount({
      id: "gitea-1",
      label: "Home Forge",
      token: "gitea_pat",
      instanceUrl: "https://git.example.com",
      email: "dev@example.com",
      username: "dev",
    });

    expect(account.isDefault).toBe(true);
    expect(account.instanceUrl).toBe("https://git.example.com");

    const retrieved = getGiteaAccountById("gitea-1");
    expect(retrieved?.label).toBe("Home Forge");
    expect(retrieved?.username).toBe("dev");
  });

  it("enforces a single default account", () => {
    createGiteaAccount({
      id: "gitea-1",
      label: "First",
      token: "pat-1",
      instanceUrl: "https://git.one",
    });
    createGiteaAccount({
      id: "gitea-2",
      label: "Second",
      token: "pat-2",
      instanceUrl: "https://git.two",
      isDefault: true,
    });

    expect(getGiteaAccountById("gitea-1")?.isDefault).toBe(false);
    expect(getGiteaAccountById("gitea-2")?.isDefault).toBe(true);
    expect(getDefaultGiteaAccount()?.id).toBe("gitea-2");
  });

  it("updates account fields", () => {
    createGiteaAccount({
      id: "gitea-1",
      label: "Old",
      token: "pat-old",
      instanceUrl: "https://git.old",
    });

    updateGiteaAccount("gitea-1", {
      label: "New",
      token: "pat-new",
      instanceUrl: "https://git.new",
      username: "newuser",
      email: "new@example.com",
    });

    const updated = getGiteaAccountById("gitea-1");
    expect(updated?.label).toBe("New");
    expect(updated?.token).toBe("pat-new");
    expect(updated?.instanceUrl).toBe("https://git.new");
    expect(updated?.username).toBe("newuser");
    expect(updated?.email).toBe("new@example.com");
  });

  it("blocks deleting an account bound to a project", () => {
    createGiteaAccount({
      id: "gitea-1",
      label: "Bound",
      token: "pat-bound",
      instanceUrl: "https://git.bound",
    });

    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-1",
        name: "Bound Project",
        description: "",
        status: "active",
        giteaAccountId: "gitea-1",
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    const result = deleteGiteaAccount("gitea-1");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Bound Project");
  });

  it("resolves project-specific account before default", () => {
    createGiteaAccount({
      id: "gitea-default",
      label: "Default",
      token: "pat-default",
      instanceUrl: "https://git.default",
      isDefault: true,
    });
    createGiteaAccount({
      id: "gitea-work",
      label: "Work",
      token: "pat-work",
      instanceUrl: "https://git.work",
      username: "worker",
      email: "worker@example.com",
    });

    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-work",
        name: "Work",
        description: "",
        status: "active",
        giteaAccountId: "gitea-work",
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    const account = resolveGiteaAccount("proj-work");
    expect(account?.id).toBe("gitea-work");
    expect(resolveGiteaToken("proj-work")).toBe("pat-work");
    expect(resolveGiteaUsername("proj-work")).toBe("worker");
    expect(resolveGiteaEmail("proj-work")).toBe("worker@example.com");
    expect(resolveGiteaInstanceUrl("proj-work")).toBe("https://git.work");
  });

  it("falls back to default when project-bound account is missing", () => {
    createGiteaAccount({
      id: "gitea-default",
      label: "Default",
      token: "pat-default",
      instanceUrl: "https://git.default",
      isDefault: true,
    });

    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-stale-binding",
        name: "Stale Binding",
        description: "",
        status: "active",
        giteaAccountId: "missing-account",
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    const account = resolveGiteaAccount("proj-stale-binding");
    expect(account?.id).toBe("gitea-default");
    expect(resolveGiteaToken("proj-stale-binding")).toBe("pat-default");
    expect(resolveGiteaInstanceUrl("proj-stale-binding")).toBe("https://git.default");
  });

  it("falls back to legacy config when no accounts exist", () => {
    configStore.set("gitea:token", "legacy-pat");
    configStore.set("gitea:instance_url", "https://git.legacy");
    configStore.set("gitea:username", "legacy-user");
    configStore.set("gitea:email", "legacy@example.com");

    const account = resolveGiteaAccount();
    expect(account?.id).toBe("__legacy__");
    expect(account?.token).toBe("legacy-pat");
    expect(account?.instanceUrl).toBe("https://git.legacy");
    expect(resolveGiteaUsername()).toBe("legacy-user");
    expect(resolveGiteaEmail()).toBe("legacy@example.com");
  });

  it("returns null/undefined when no Gitea config exists", () => {
    expect(resolveGiteaAccount()).toBeNull();
    expect(resolveGiteaToken()).toBeUndefined();
    expect(resolveGiteaUsername()).toBeUndefined();
    expect(resolveGiteaEmail()).toBeUndefined();
    expect(resolveGiteaInstanceUrl()).toBeUndefined();
    expect(getGiteaAccounts()).toEqual([]);
  });

  it("allows setting default account explicitly", () => {
    createGiteaAccount({ id: "g-1", label: "one", token: "p1", instanceUrl: "https://g1" });
    createGiteaAccount({ id: "g-2", label: "two", token: "p2", instanceUrl: "https://g2" });

    setDefaultGiteaAccount("g-2");

    expect(getGiteaAccountById("g-1")?.isDefault).toBe(false);
    expect(getGiteaAccountById("g-2")?.isDefault).toBe(true);
  });

  it("rejects account creation with non-http(s) instance URL", () => {
    expect(() =>
      createGiteaAccount({
        id: "bad-1",
        label: "Bad",
        token: "pat",
        instanceUrl: "--upload-pack=evil",
      }),
    ).toThrow(/must start with http:\/\/ or https:\/\//);
  });

  it("rejects account creation with empty token", () => {
    expect(() =>
      createGiteaAccount({
        id: "bad-2",
        label: "Bad",
        token: "  ",
        instanceUrl: "https://git.example.com",
      }),
    ).toThrow(/token must not be empty/);
  });

  it("rejects account update with non-http(s) instance URL", () => {
    createGiteaAccount({
      id: "g-valid",
      label: "Valid",
      token: "pat",
      instanceUrl: "https://git.example.com",
    });

    expect(() =>
      updateGiteaAccount("g-valid", { instanceUrl: "ftp://evil.com" }),
    ).toThrow(/must start with http:\/\/ or https:\/\//);
  });

  it("rejects account update with empty token", () => {
    createGiteaAccount({
      id: "g-valid2",
      label: "Valid",
      token: "pat",
      instanceUrl: "https://git.example.com",
    });

    expect(() =>
      updateGiteaAccount("g-valid2", { token: "" }),
    ).toThrow(/token must not be empty/);
  });
});
