import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openControlDb, type ControlDb } from "../db/control-db.js";
import { ProjectStore } from "./project-store.js";

describe("ProjectStore", () => {
  let dir: string;
  let control: ControlDb;
  let store: ProjectStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-proj-"));
    control = openControlDb(join(dir, "control.db"));
    store = new ProjectStore(control, join(dir, "projects"));
  });

  afterEach(() => {
    control.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a project with an initialized git repo on disk", () => {
    const p = store.create("My App");
    expect(p.name).toBe("My App");
    expect(existsSync(p.repoPath)).toBe(true);
    expect(existsSync(join(p.repoPath, ".git"))).toBe(true);
    expect(store.get(p.id)).toEqual(p);
    expect(store.list()).toHaveLength(1);
  });

  it("rejects a blank name", () => {
    expect(() => store.create("   ")).toThrow(/name is required/i);
  });

  it("manages membership idempotently and resolves an agent's repo path", () => {
    const p = store.create("Shared");
    store.addMember(p.id, "claude");
    store.addMember(p.id, "claude"); // idempotent
    store.addMember(p.id, "codex");
    expect(store.listMembers(p.id).sort()).toEqual(["claude", "codex"]);
    expect(store.repoPathForAgent("claude")).toBe(p.repoPath);
    expect(store.repoPathForAgent("nobody")).toBeNull();

    store.removeMember(p.id, "claude");
    expect(store.listMembers(p.id)).toEqual(["codex"]);
    expect(store.repoPathForAgent("claude")).toBeNull();
  });

  it("refuses to add a member to an unknown project", () => {
    expect(() => store.addMember("does-not-exist", "claude")).toThrow(/unknown project/i);
  });

  it("deletes a project, its members, and its on-disk tree", () => {
    const p = store.create("Temp");
    store.addMember(p.id, "claude");
    store.delete(p.id);
    expect(store.get(p.id)).toBeNull();
    expect(store.listMembers(p.id)).toEqual([]);
    expect(existsSync(p.repoPath)).toBe(false);
  });

  it("binds the most recently created project when an agent is in several", () => {
    const a = store.create("A");
    const b = store.create("B");
    store.addMember(a.id, "claude");
    store.addMember(b.id, "claude");
    // b was created after a, so it wins.
    expect(store.repoPathForAgent("claude")).toBe(b.repoPath);
  });
});
