import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../index.js";
import { eq } from "drizzle-orm";

// Mock auth (required by seed.js which is called from migrateDb)
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

describe("DB Migration — GitHub project columns", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-db-gh-test-"));
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

  it("creates a project with github_repo column", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-1",
        name: "Test Project",
        description: "desc",
        githubRepo: "owner/repo",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-1"))
      .get();

    expect(project).toBeDefined();
    expect(project!.githubRepo).toBe("owner/repo");
  });

  it("creates a project with github_branch column", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-2",
        name: "Test Project",
        description: "desc",
        githubBranch: "develop",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-2"))
      .get();

    expect(project!.githubBranch).toBe("develop");
  });

  it("defaults github_issue_monitor to false", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-3",
        name: "Test Project",
        description: "desc",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-3"))
      .get();

    expect(project!.githubIssueMonitor).toBe(false);
  });

  it("stores github_issue_monitor as true", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-4",
        name: "Test Project",
        description: "desc",
        githubIssueMonitor: true,
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-4"))
      .get();

    expect(project!.githubIssueMonitor).toBe(true);
  });

  it("defaults rules to empty array", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-5",
        name: "Test Project",
        description: "desc",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-5"))
      .get();

    expect(project!.rules).toEqual([]);
  });

  it("stores and retrieves rules as a JSON array", () => {
    const db = getDb();
    const rules = ["Always sign commits", "Use conventional commits"];
    db.insert(schema.projects)
      .values({
        id: "test-gh-6",
        name: "Test Project",
        description: "desc",
        rules,
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-6"))
      .get();

    expect(project!.rules).toEqual(rules);
  });

  it("allows null for github_repo and github_branch", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-7",
        name: "Test Project",
        description: "desc",
        githubRepo: null,
        githubBranch: null,
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-7"))
      .get();

    expect(project!.githubRepo).toBeNull();
    expect(project!.githubBranch).toBeNull();
  });

  it("supports a complete GitHub-linked project", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "test-gh-full",
        name: "Full GitHub Project",
        description: "A fully configured GitHub project",
        status: "active",
        githubRepo: "myorg/myrepo",
        githubBranch: "dev",
        githubIssueMonitor: true,
        rules: ["Sign commits", "Branch from dev"],
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "test-gh-full"))
      .get();

    expect(project).toBeDefined();
    expect(project!.githubRepo).toBe("myorg/myrepo");
    expect(project!.githubBranch).toBe("dev");
    expect(project!.githubIssueMonitor).toBe(true);
    expect(project!.rules).toEqual(["Sign commits", "Branch from dev"]);
  });
});
