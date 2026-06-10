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

  it("adds members read-only by default and resolves access", () => {
    const p = store.create("Acc");
    store.addMember(p.id, "bot");
    expect(store.listMembersDetailed(p.id)).toEqual([{ agentId: "bot", access: "read" }]);
    expect(store.accessForAgent("bot")).toBe("read");
    expect(store.accessForAgent("nobody")).toBeNull();
  });

  it("supports write members, updates access, and re-add overwrites access", () => {
    const p = store.create("Acc");
    store.addMember(p.id, "coder", "write");
    expect(store.accessForAgent("coder")).toBe("write");
    store.setMemberAccess(p.id, "coder", "read");
    expect(store.accessForAgent("coder")).toBe("read");
    store.addMember(p.id, "coder", "write"); // re-add is deterministic
    expect(store.accessForAgent("coder")).toBe("write");
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

  it("round-trips fork mode: upstream in forgeRepo, the fork in forkRepo", () => {
    const p = store.create("Forked");
    expect(p.forkRepo).toBeNull();
    store.setForge(p.id, {
      mode: "fork",
      forgeAccountId: "acc1",
      forgeRepo: "upstream/app", // PR base + issue monitoring
      forkRepo: "bot/app", // clone/push target
      forgeSshUrl: "git@github.com:bot/app.git",
      monitorIssues: true,
    });
    const updated = store.get(p.id)!;
    expect(updated.mode).toBe("fork");
    expect(updated.forgeRepo).toBe("upstream/app");
    expect(updated.forkRepo).toBe("bot/app");
    expect(updated.forgeSshUrl).toBe("git@github.com:bot/app.git");
    // Monitoring still keys off the upstream repo.
    expect(store.listMonitored().find((x) => x.id === p.id)?.forgeRepo).toBe("upstream/app");
  });

  it("defaults remoteE2e off and round-trips the flag via setForge", () => {
    const p = store.create("E2E Toggle");
    expect(p.remoteE2e).toBe(false);
    // Turn it on alongside an existing-repo config.
    store.setForge(p.id, {
      mode: "existing",
      forgeAccountId: "acc1",
      forgeRepo: "o/n",
      remoteE2e: true,
    });
    expect(store.get(p.id)!.remoteE2e).toBe(true);
    // And a local-mode save can turn it back off.
    store.setForge(p.id, { mode: "local", remoteE2e: false });
    expect(store.get(p.id)!.remoteE2e).toBe(false);
  });

  it("reports per-repo working-tree changes (drives multi-repo publish)", () => {
    const p = store.create("Changes");
    const docs = store.addRepo(p.id, { name: "docs" });
    const primary = store.primaryRepo(p.id)!;
    // Both repos start clean.
    expect(store.hasChanges(primary.repoPath)).toBe(false);
    expect(store.hasChanges(docs.repoPath)).toBe(false);
    // Touch only the docs repo — publish should target it and skip the other.
    writeFileSync(join(docs.repoPath, "README.md"), "# docs");
    expect(store.hasChanges(docs.repoPath)).toBe(true);
    expect(store.hasChanges(primary.repoPath)).toBe(false);
    store.commitAll(docs.repoPath, "add readme");
    expect(store.hasChanges(docs.repoPath)).toBe(false);
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

  it("creates a project as a workspace holding one primary repo", () => {
    const p = store.create("Multi");
    expect(p.workspacePath).toBe(join(dir, "projects", p.id));
    const repos = store.listRepos(p.id);
    expect(repos).toHaveLength(1);
    expect(repos[0].isPrimary).toBe(true);
    expect(repos[0].name).toBe("repo");
    expect(p.repoPath).toBe(repos[0].repoPath);
    // The primary repo lives as a subdir of the workspace.
    expect(repos[0].repoPath).toBe(join(p.workspacePath, "repo"));
    expect(existsSync(join(repos[0].repoPath, ".git"))).toBe(true);
  });

  it("adds repos as sibling subdirs and uniquifies names", () => {
    const p = store.create("Umbrella");
    const a = store.addRepo(p.id, { name: "otterbot" });
    const b = store.addRepo(p.id, { name: "otterbot-site" });
    const dup = store.addRepo(p.id, { name: "otterbot" }); // name clash
    expect(a.isPrimary).toBe(false);
    expect(b.repoPath).toBe(join(p.workspacePath, "otterbot-site"));
    expect(dup.name).toBe("otterbot-2");
    expect(existsSync(join(a.repoPath, ".git"))).toBe(true);
    expect(store.listRepos(p.id).map((r) => r.name)).toEqual([
      "repo",
      "otterbot",
      "otterbot-site",
      "otterbot-2",
    ]);
  });

  it("switches the primary repo and reflects it in the Project view", () => {
    const p = store.create("Promote");
    const site = store.addRepo(p.id, { name: "site" });
    store.setRepoForge(site.id, { mode: "existing", forgeAccountId: "acc", forgeRepo: "o/site" });
    store.setPrimaryRepo(site.id);
    expect(store.listRepos(p.id).filter((r) => r.isPrimary)).toHaveLength(1);
    const view = store.get(p.id)!;
    expect(view.repoPath).toBe(site.repoPath);
    expect(view.forgeRepo).toBe("o/site");
  });

  it("removes a repo and its subdir, promoting the next when the primary goes", () => {
    const p = store.create("Trim");
    const second = store.addRepo(p.id, { name: "docs" });
    const primaryPath = store.primaryRepo(p.id)!.repoPath;
    // Remove the primary ("repo") — "docs" should be promoted.
    const primaryId = store.primaryRepo(p.id)!.id;
    store.removeRepo(primaryId);
    expect(existsSync(primaryPath)).toBe(false);
    expect(store.primaryRepo(p.id)!.id).toBe(second.id);
    // Can't remove the last remaining repo.
    expect(() => store.removeRepo(second.id)).toThrow(/at least one repo/i);
  });

  it("resolves an agent's workspace path via membership", () => {
    const p = store.create("WS");
    store.addRepo(p.id, { name: "extra" });
    store.addMember(p.id, "coder");
    expect(store.workspacePathForAgent("coder")).toBe(p.workspacePath);
    expect(store.workspacePathForAgent("nobody")).toBeNull();
  });

  it("backfills a legacy single-repo project on reopen", () => {
    const p = store.create("Legacy");
    // Simulate a pre-multi-repo row: clear the new model, leave only legacy cols.
    control.sqlite.prepare(`DELETE FROM project_repos WHERE project_id = ?`).run(p.id);
    control.sqlite
      .prepare(`UPDATE projects SET workspace_path = NULL, mode = 'existing', forge_repo = 'o/n', monitor_issues = 1 WHERE id = ?`)
      .run(p.id);
    control.close();
    // Reopening runs ensureControlTables → backfillProjectRepos.
    control = openControlDb(join(dir, "control.db"));
    store = new ProjectStore(control, join(dir, "projects"));
    const repos = store.listRepos(p.id);
    expect(repos).toHaveLength(1);
    expect(repos[0].isPrimary).toBe(true);
    expect(repos[0].forgeRepo).toBe("o/n");
    expect(repos[0].monitorIssues).toBe(true);
    const view = store.get(p.id)!;
    expect(view.workspacePath).toBe(join(dir, "projects", p.id));
    expect(view.forgeRepo).toBe("o/n");
  });

  it("clones a public URL credential-free and refreshes it with pull()", () => {
    // Stand up a local "remote" repo to act as the public source.
    const remote = mkdtempSync(join(tmpdir(), "otter-remote-"));
    const git = (args: string[], cwd = remote) =>
      spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    git(["init"]);
    git(["config", "user.email", "r@example.com"]);
    git(["config", "user.name", "remote"]);
    writeFileSync(join(remote, "a.txt"), "one");
    git(["add", "-A"]);
    git(["commit", "-m", "first"]);

    const p = store.create("Mirror");
    const repo = store.primaryRepo(p.id)!;
    // No credentials: authedUrl === plainUrl, empty git context.
    const clone = store.cloneInto(repo.repoPath, remote, remote, {});
    expect(clone.ok).toBe(true);
    expect(existsSync(join(repo.repoPath, "a.txt"))).toBe(true);

    // Advance the remote, then refresh — the new file should appear.
    writeFileSync(join(remote, "b.txt"), "two");
    git(["add", "-A"]);
    git(["commit", "-m", "second"]);
    const pulled = store.pull(repo.repoPath, {});
    expect(pulled.ok).toBe(true);
    expect(existsSync(join(repo.repoPath, "b.txt"))).toBe(true);

    rmSync(remote, { recursive: true, force: true });
  });

  it("lists public-mode repos for the periodic refresher", () => {
    const p = store.create("Pub");
    const a = store.primaryRepo(p.id)!;
    const extra = store.addRepo(p.id, { name: "lib" });
    expect(store.listPublicRepos()).toHaveLength(0);
    store.setRepoForge(a.id, { mode: "public", publicUrl: "https://github.com/o/n" });
    store.setRepoForge(extra.id, { mode: "local" });
    const pub = store.listPublicRepos();
    expect(pub.map((r) => r.id)).toEqual([a.id]);
    expect(pub[0].publicUrl).toBe("https://github.com/o/n");
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
