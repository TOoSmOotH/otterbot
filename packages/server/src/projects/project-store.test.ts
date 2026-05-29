import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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

  it("stores and clears project rules", () => {
    const p = store.create("Ruled");
    expect(p.rules).toBeNull();
    store.setRules(p.id, "Always commit to dev.\nWrite tests first.");
    expect(store.get(p.id)!.rules).toBe("Always commit to dev.\nWrite tests first.");
    store.setRules(p.id, null);
    expect(store.get(p.id)!.rules).toBeNull();
  });

  it("resolves rules for an agent via project membership (most recent wins)", () => {
    const p = store.create("Ruled");
    store.setRules(p.id, "House style applies.");
    store.addMember(p.id, "coder");
    expect(store.rulesForAgent("coder")).toBe("House style applies.");
    expect(store.rulesForAgent("stranger")).toBeNull();
  });

  it("defaults to local mode and updates forge config", () => {
    const p = store.create("Forge Me");
    expect(p.mode).toBe("local");
    store.setForge(p.id, { mode: "existing", forgeAccountId: "acc1", forgeRepo: "o/n", monitorIssues: true });
    const updated = store.get(p.id)!;
    expect(updated.mode).toBe("existing");
    expect(updated.forgeRepo).toBe("o/n");
    expect(updated.monitorIssues).toBe(true);
    expect(store.listMonitored().some((x) => x.id === p.id)).toBe(true);
  });

  it("creates branches and commits changes in the working tree", () => {
    const p = store.create("Git Ops");
    expect(store.ensureBranch(p.repoPath, "feature/x").ok).toBe(true);
    writeFileSync(join(p.repoPath, "hello.txt"), "hi");
    const commit = store.commitAll(p.repoPath, "add hello");
    expect(commit.ok).toBe(true);
    // A second commit with no changes reports nothing to commit.
    const noop = store.commitAll(p.repoPath, "again");
    expect(noop.ok).toBe(false);
    expect(noop.output).toMatch(/nothing to commit/);
  });

  it("SSH-signs commits when a signing key is given in the git context", () => {
    const p = store.create("Signed");
    // Generate a throwaway ssh key to sign with.
    const keyDir = mkdtempSync(join(tmpdir(), "otter-signkey-"));
    const keyPath = join(keyDir, "id_ed25519");
    spawnSync("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", "test"]);
    const ctx = {
      committer: { name: "Otter", email: "otter@example.com" },
      signingKeyPath: `${keyPath}.pub`,
    };
    writeFileSync(join(p.repoPath, "f.txt"), "x");
    const commit = store.commitAll(p.repoPath, "signed commit", ctx);
    expect(commit.ok).toBe(true);
    // The commit object carries a gpgsig header (SSH signature).
    const show = spawnSync("git", ["-C", p.repoPath, "cat-file", "-p", "HEAD"], { encoding: "utf8" });
    expect(show.stdout).toContain("gpgsig");
    const author = spawnSync("git", ["-C", p.repoPath, "log", "-1", "--format=%an <%ae>"], { encoding: "utf8" });
    expect(author.stdout.trim()).toBe("Otter <otter@example.com>");
    rmSync(keyDir, { recursive: true, force: true });
  });
});
