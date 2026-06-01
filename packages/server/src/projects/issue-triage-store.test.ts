import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { IssueTriageStore } from "./issue-triage-store.js";

describe("IssueTriageStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: IssueTriageStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-triage-"));
    control = openControlDb(join(dir, "control.db"));
    store = new IssueTriageStore(control);
  });
  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an untriaged issue", () => {
    expect(store.get("p1", 7)).toBeNull();
  });

  it("upserts a plan + watermark and reads it back", () => {
    store.upsert("p1", 7, "first plan", 100);
    expect(store.get("p1", 7)).toEqual({ plan: "first plan", lastCommentId: 100 });
    store.upsert("p1", 7, "revised plan", 140);
    expect(store.get("p1", 7)).toEqual({ plan: "revised plan", lastCommentId: 140 });
  });

  it("advances only the watermark, keeping the plan", () => {
    store.upsert("p1", 7, "plan", 100);
    store.advanceWatermark("p1", 7, 120);
    expect(store.get("p1", 7)).toEqual({ plan: "plan", lastCommentId: 120 });
  });
});
