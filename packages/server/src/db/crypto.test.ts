import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, controlSchema } from "./control-db.js";

describe("database encryption", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-crypto-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips data when opened with the correct key", () => {
    const path = join(dir, "enc.db");
    const a = openControlDb(path, "correct-horse-battery-staple");
    a.db.insert(controlSchema.appSettings).values({ key: "onboarding", value: "done" }).run();
    a.close();

    const b = openControlDb(path, "correct-horse-battery-staple");
    const rows = b.db.select().from(controlSchema.appSettings).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("done");
    b.close();
  });

  it("cannot be opened with the wrong key", () => {
    const path = join(dir, "enc.db");
    const a = openControlDb(path, "the-right-key");
    a.db.insert(controlSchema.appSettings).values({ key: "k", value: "v" }).run();
    a.close();

    expect(() => openControlDb(path, "the-wrong-key")).toThrow();
  });
});
