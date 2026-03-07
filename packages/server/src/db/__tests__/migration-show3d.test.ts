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

describe("DB Migration — show_3d project column", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-db-show3d-test-"));
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

  it("defaults show3d to true for new projects", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-show3d-default",
        name: "Default 3D Project",
        description: "desc",
        createdAt: new Date().toISOString(),
      })
      .run();

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "proj-show3d-default"))
      .get();

    expect(project).toBeDefined();
    expect(project!.show3d).toBe(true);
  });

  it("persists show3d = false and show3d = true", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-show3d-off",
        name: "3D Hidden Project",
        description: "desc",
        show3d: false,
        createdAt: new Date().toISOString(),
      })
      .run();

    db.insert(schema.projects)
      .values({
        id: "proj-show3d-on",
        name: "3D Visible Project",
        description: "desc",
        show3d: true,
        createdAt: new Date().toISOString(),
      })
      .run();

    const hidden = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "proj-show3d-off"))
      .get();
    const visible = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, "proj-show3d-on"))
      .get();

    expect(hidden!.show3d).toBe(false);
    expect(visible!.show3d).toBe(true);
  });
});
