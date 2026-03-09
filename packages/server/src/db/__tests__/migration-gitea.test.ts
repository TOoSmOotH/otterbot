import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../index.js";
import { eq } from "drizzle-orm";

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

describe("DB Migration — Gitea columns and table", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-db-gitea-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores project-level Gitea fields", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-gitea",
        name: "Gitea Project",
        description: "desc",
        giteaRepo: "team/repo",
        giteaBranch: "develop",
        giteaIssueMonitor: true,
        giteaAccountId: "acct-1",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "proj-gitea"))
      .get();

    expect(project).toBeDefined();
    expect(project!.giteaRepo).toBe("team/repo");
    expect(project!.giteaBranch).toBe("develop");
    expect(project!.giteaIssueMonitor).toBe(true);
    expect(project!.giteaAccountId).toBe("acct-1");
  });

  it("defaults gitea_issue_monitor to false", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-gitea-default",
        name: "Gitea Default",
        description: "desc",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "proj-gitea-default"))
      .get();

    expect(project!.giteaIssueMonitor).toBe(false);
    expect(project!.giteaRepo).toBeNull();
    expect(project!.giteaBranch).toBeNull();
    expect(project!.giteaAccountId).toBeNull();
  });

  it("creates and retrieves gitea_accounts rows", () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.insert(schema.giteaAccounts)
      .values({
        id: "acct-1",
        label: "Self-hosted",
        token: "pat",
        instanceUrl: "https://git.example.com",
        username: "dev",
        email: "dev@example.com",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const account = db
      .select()
      .from(schema.giteaAccounts)
      .where(eq(schema.giteaAccounts.id, "acct-1"))
      .get();

    expect(account).toBeDefined();
    expect(account!.instanceUrl).toBe("https://git.example.com");
    expect(account!.isDefault).toBe(true);
    expect(account!.username).toBe("dev");
  });
});
