import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { controlSchema, type ControlDb } from "../db/control-db.js";

/**
 * Collaborative projects: a project is a single git working tree that several
 * agents share. The tree is bound, writable, into each member agent's sandbox
 * at `/project` (see `integrations/shell.ts`), so members edit one codebase
 * while their own `/workspace` — and the per-tool CLI credentials they log in
 * there — stays private.
 *
 * State lives in the control database (`projects`, `project_members`); the tree
 * lives on disk at `<projectsRoot>/<id>/repo` and is `git init`'d on creation.
 * Phase 1 is local-only (no remote/clone/PR).
 */

/** Git/forge backing for a single repo. Lives on each {@link ProjectRepo}. */
export interface RepoForge {
  /** Where the code lives. */
  mode: "local" | "existing" | "new" | "fork";
  /** Forge account id (forge_accounts.id) when mode != local. */
  forgeAccountId: string | null;
  /** owner/name of the upstream repo on the forge when mode != local. */
  forgeRepo: string | null;
  /** owner/name of the bot's fork (clone/push target) when mode == fork. */
  forkRepo: string | null;
  /** SSH clone/push URL captured from the forge (the fork's URL when mode == fork). */
  forgeSshUrl: string | null;
  /** Base/integration branch PRs target. */
  baseBranch: string | null;
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: boolean;
  /** Poll the forge for new unassigned issues; PM posts/refines a plan comment. */
  triageIssues: boolean;
}

/** One repo within a project: its on-disk subdir path + its own git/forge backing. */
export interface ProjectRepo extends RepoForge {
  id: string;
  projectId: string;
  /** Subdir name under the workspace and the repo's display label. */
  name: string;
  /** Absolute path to this repo's working tree (`<workspace>/<name>`). */
  repoPath: string;
  /** The project's primary repo — backs legacy single-repo surfaces. */
  isPrimary: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  /**
   * Absolute path to the project's *workspace* dir, bound at `/project` in
   * member sandboxes. Holds each repo as a sibling subdir.
   */
  workspacePath: string;
  /**
   * Absolute path to the *primary* repo's working tree. Convenience for the
   * legacy single-repo surfaces; the full set is {@link ProjectStore.listRepos}.
   */
  repoPath: string;
  /** Where the primary repo's code lives. */
  mode: "local" | "existing" | "new" | "fork";
  /** Forge account id (forge_accounts.id) when the primary repo's mode != local. */
  forgeAccountId: string | null;
  /** owner/name of the primary repo's upstream on the forge. */
  forgeRepo: string | null;
  /** owner/name of the primary repo's fork (clone/push target) when mode == fork. */
  forkRepo: string | null;
  /** SSH clone/push URL for the primary repo. */
  forgeSshUrl: string | null;
  /** Base/integration branch the primary repo's PRs target. */
  baseBranch: string | null;
  /** Primary repo: poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: boolean;
  /** Primary repo: poll the forge for new unassigned issues; PM posts a plan. */
  triageIssues: boolean;
  /** Run remote-host (Proxmox/SSH VM) end-to-end tests in the tester stage. */
  remoteE2e: boolean;
  /** Standing rules injected into every project member's system prompt. */
  rules: string | null;
  createdAt: string;
}

/** Result of a host-side git operation. */
export interface GitOpResult {
  ok: boolean;
  output: string;
}

/** Transport + identity/signing context for host-side git operations. */
export interface GitContext {
  /** Private key for SSH transport; when set, git uses SSH instead of HTTPS. */
  sshKeyPath?: string;
  knownHostsPath?: string;
  committer?: { name: string; email: string };
  /** SSH public-key path used for commit signing, when enabled. */
  signingKeyPath?: string;
}

/** Git identity stamped into a fresh repo so in-sandbox commits succeed. */
const GIT_USER_NAME = "otterbot";
const GIT_USER_EMAIL = "otterbot@localhost";

export class ProjectStore {
  /**
   * @param control      the shared control database
   * @param projectsRoot directory under which each project's `repo` tree lives
   *                     (typically `<dataDir>/projects`)
   */
  constructor(
    private readonly control: ControlDb,
    private readonly projectsRoot: string
  ) {
    mkdirSync(projectsRoot, { recursive: true });
  }

  /**
   * Create a project: scaffold its workspace dir, seed one primary repo
   * (`<workspace>/repo`, `git init`'d), and persist the rows.
   */
  create(name: string): Project {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Project name is required.");
    const id = nanoid();
    const workspacePath = resolve(this.projectsRoot, id);
    mkdirSync(workspacePath, { recursive: true });

    const createdAt = new Date().toISOString();
    this.control.db
      .insert(controlSchema.projects)
      // repo_path is legacy/NOT NULL — seed it with the primary repo's path.
      .values({ id, name: trimmed, workspacePath, repoPath: resolve(workspacePath, "repo"), createdAt })
      .run();
    this.addRepo(id, { name: "repo", primary: true });
    return this.get(id)!;
  }

  // --- Repos within a project ----------------------------------------------

  /**
   * Add a repo to a project: scaffold `<workspace>/<slug>`, `git init` it, and
   * persist the row (local mode; configure a forge backing afterward with
   * {@link setRepoForge}). The first repo, or one created with `primary:true`,
   * becomes the project's primary repo.
   */
  addRepo(projectId: string, opts: { name?: string; primary?: boolean } = {}): ProjectRepo {
    const project = this.control.db
      .select()
      .from(controlSchema.projects)
      .where(eq(controlSchema.projects.id, projectId))
      .get();
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const workspacePath = project.workspacePath ?? resolve(this.projectsRoot, projectId);
    const slug = this.uniqueRepoName(projectId, opts.name ?? "repo");
    const repoPath = resolve(workspacePath, slug);
    mkdirSync(repoPath, { recursive: true });
    this.gitInit(repoPath);

    const isPrimary = opts.primary ?? this.listRepos(projectId).length === 0;
    const repoId = nanoid();
    this.control.db
      .insert(controlSchema.projectRepos)
      .values({ id: repoId, projectId, name: slug, repoPath, isPrimary, createdAt: new Date().toISOString() })
      .run();
    if (isPrimary) this.demoteOtherPrimaries(projectId, repoId);
    return this.getRepo(repoId)!;
  }

  /** Repos in a project, primary first then oldest-first. */
  listRepos(projectId: string): ProjectRepo[] {
    return this.control.db
      .select()
      .from(controlSchema.projectRepos)
      .where(eq(controlSchema.projectRepos.projectId, projectId))
      .all()
      .sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt)
      );
  }

  getRepo(repoId: string): ProjectRepo | null {
    return (
      this.control.db
        .select()
        .from(controlSchema.projectRepos)
        .where(eq(controlSchema.projectRepos.id, repoId))
        .get() ?? null
    );
  }

  /** A project's primary repo (the one backing legacy single-repo surfaces). */
  primaryRepo(projectId: string): ProjectRepo | null {
    return this.listRepos(projectId)[0] ?? null;
  }

  /** Update a repo's git/forge configuration. */
  setRepoForge(repoId: string, patch: Partial<RepoForge>): void {
    this.control.db
      .update(controlSchema.projectRepos)
      .set(patch)
      .where(eq(controlSchema.projectRepos.id, repoId))
      .run();
  }

  /** Make `repoId` its project's primary repo, demoting the previous one. */
  setPrimaryRepo(repoId: string): void {
    const repo = this.getRepo(repoId);
    if (!repo) return;
    this.demoteOtherPrimaries(repo.projectId, repoId);
    this.control.db
      .update(controlSchema.projectRepos)
      .set({ isPrimary: true })
      .where(eq(controlSchema.projectRepos.id, repoId))
      .run();
  }

  /**
   * Remove a repo and its on-disk subdir. A project must keep at least one repo;
   * removing the primary promotes the next remaining repo.
   */
  removeRepo(repoId: string): void {
    const repo = this.getRepo(repoId);
    if (!repo) return;
    if (this.listRepos(repo.projectId).length <= 1) {
      throw new Error("A project must keep at least one repo.");
    }
    this.control.db
      .delete(controlSchema.projectRepos)
      .where(eq(controlSchema.projectRepos.id, repoId))
      .run();
    if (existsSync(repo.repoPath)) rmSync(repo.repoPath, { recursive: true, force: true });
    if (repo.isPrimary) {
      const next = this.listRepos(repo.projectId)[0];
      if (next) {
        this.control.db
          .update(controlSchema.projectRepos)
          .set({ isPrimary: true })
          .where(eq(controlSchema.projectRepos.id, next.id))
          .run();
      }
    }
  }

  private demoteOtherPrimaries(projectId: string, keepId: string): void {
    this.control.db
      .update(controlSchema.projectRepos)
      .set({ isPrimary: false })
      .where(
        and(
          eq(controlSchema.projectRepos.projectId, projectId),
          ne(controlSchema.projectRepos.id, keepId)
        )
      )
      .run();
  }

  /** A filesystem-safe, project-unique subdir/display name for a new repo. */
  private uniqueRepoName(projectId: string, raw: string): string {
    const base =
      raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "") || "repo";
    const taken = new Set(this.listRepos(projectId).map((r) => r.name));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  /** Compose a Project view: the row plus its primary repo's forge fields. */
  private rowToProject(row: typeof controlSchema.projects.$inferSelect): Project {
    const primary = this.primaryRepo(row.id);
    return {
      id: row.id,
      name: row.name,
      workspacePath: row.workspacePath ?? resolve(this.projectsRoot, row.id),
      repoPath: primary?.repoPath ?? row.repoPath,
      mode: primary?.mode ?? "local",
      forgeAccountId: primary?.forgeAccountId ?? null,
      forgeRepo: primary?.forgeRepo ?? null,
      forkRepo: primary?.forkRepo ?? null,
      forgeSshUrl: primary?.forgeSshUrl ?? null,
      baseBranch: primary?.baseBranch ?? null,
      monitorIssues: primary?.monitorIssues ?? false,
      triageIssues: primary?.triageIssues ?? false,
      remoteE2e: row.remoteE2e,
      rules: row.rules,
      createdAt: row.createdAt,
    };
  }

  /**
   * Update the *primary* repo's forge configuration (legacy single-repo entry
   * point). `remoteE2e` is project-wide and is split off to the project row.
   */
  setForge(
    projectId: string,
    patch: Partial<RepoForge & Pick<Project, "remoteE2e">>
  ): void {
    const { remoteE2e, ...forge } = patch;
    if (remoteE2e !== undefined) {
      this.control.db
        .update(controlSchema.projects)
        .set({ remoteE2e })
        .where(eq(controlSchema.projects.id, projectId))
        .run();
    }
    const primary = this.primaryRepo(projectId);
    if (primary && Object.keys(forge).length) this.setRepoForge(primary.id, forge);
  }

  /** Set (or clear, with null) the project's standing rules. */
  setRules(projectId: string, rules: string | null): void {
    this.control.db
      .update(controlSchema.projects)
      .set({ rules })
      .where(eq(controlSchema.projects.id, projectId))
      .run();
  }

  /**
   * The standing rules for the agent's project, or null. Like
   * {@link repoPathForAgent}, the most recently created project wins when the
   * agent is in several.
   */
  rulesForAgent(agentId: string): string | null {
    return this.projectsForAgent(agentId)[0]?.rules ?? null;
  }

  /** Projects with issue-monitoring enabled (for the poller). */
  listMonitored(): Project[] {
    return this.list().filter((p) => p.monitorIssues && p.forgeAccountId && p.forgeRepo);
  }

  /** Projects with PM issue-triage enabled (for the poller). */
  listTriageEnabled(): Project[] {
    return this.list().filter((p) => p.triageIssues && p.forgeAccountId && p.forgeRepo);
  }

  list(): Project[] {
    return this.control.db
      .select()
      .from(controlSchema.projects)
      .all()
      .map((row) => this.rowToProject(row));
  }

  get(id: string): Project | null {
    const row = this.control.db
      .select()
      .from(controlSchema.projects)
      .where(eq(controlSchema.projects.id, id))
      .get();
    return row ? this.rowToProject(row) : null;
  }

  /** Delete a project: remove its members, repos, row, and on-disk tree. */
  delete(id: string): void {
    const project = this.get(id);
    this.control.db
      .delete(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.projectId, id))
      .run();
    this.control.db
      .delete(controlSchema.projectRepos)
      .where(eq(controlSchema.projectRepos.projectId, id))
      .run();
    this.control.db.delete(controlSchema.projects).where(eq(controlSchema.projects.id, id)).run();
    if (project) {
      // Remove the whole `<projectsRoot>/<id>` dir, not just `repo`.
      const dir = resolve(this.projectsRoot, id);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Add an agent to a project with the given access (default read-only). Re-adding
   * an existing member updates its access deterministically.
   */
  addMember(projectId: string, agentId: string, access: "read" | "write" = "read"): void {
    if (!this.get(projectId)) throw new Error(`Unknown project: ${projectId}`);
    this.control.db
      .insert(controlSchema.projectMembers)
      .values({ projectId, agentId, access, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [controlSchema.projectMembers.projectId, controlSchema.projectMembers.agentId],
        set: { access },
      })
      .run();
  }

  /** Change an existing member's access level. */
  setMemberAccess(projectId: string, agentId: string, access: "read" | "write"): void {
    this.control.db
      .update(controlSchema.projectMembers)
      .set({ access })
      .where(
        and(
          eq(controlSchema.projectMembers.projectId, projectId),
          eq(controlSchema.projectMembers.agentId, agentId)
        )
      )
      .run();
  }

  removeMember(projectId: string, agentId: string): void {
    this.control.db
      .delete(controlSchema.projectMembers)
      .where(
        and(
          eq(controlSchema.projectMembers.projectId, projectId),
          eq(controlSchema.projectMembers.agentId, agentId)
        )
      )
      .run();
  }

  /** Agent ids that belong to a project. */
  listMembers(projectId: string): string[] {
    return this.control.db
      .select({ agentId: controlSchema.projectMembers.agentId })
      .from(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.projectId, projectId))
      .all()
      .map((r) => r.agentId);
  }

  /** Project members with their per-member access level. */
  listMembersDetailed(projectId: string): Array<{ agentId: string; access: "read" | "write" }> {
    return this.control.db
      .select({
        agentId: controlSchema.projectMembers.agentId,
        access: controlSchema.projectMembers.access,
      })
      .from(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.projectId, projectId))
      .all();
  }

  /**
   * The access level for the agent's project — the membership row of the same
   * project repoPathForAgent resolves (most recently created wins), or null when
   * the agent belongs to no project.
   */
  accessForAgent(agentId: string): "read" | "write" | null {
    const project = this.projectsForAgent(agentId)[0];
    if (!project) return null;
    return (
      this.control.db
        .select({ access: controlSchema.projectMembers.access })
        .from(controlSchema.projectMembers)
        .where(
          and(
            eq(controlSchema.projectMembers.projectId, project.id),
            eq(controlSchema.projectMembers.agentId, agentId)
          )
        )
        .get()?.access ?? null
    );
  }

  /** The projects an agent belongs to, most-recently-joined first. */
  projectsForAgent(agentId: string): Project[] {
    const rows = this.control.db
      .select({ projectId: controlSchema.projectMembers.projectId })
      .from(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.agentId, agentId))
      .all();
    return rows
      .map((r) => this.get(r.projectId))
      .filter((p): p is Project => p !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * The working-tree path bound into an agent's sandbox, or null when the agent
   * belongs to no project. Phase 1 binds a single project — if an agent is in
   * several, the most recently created one wins.
   */
  repoPathForAgent(agentId: string): string | null {
    return this.projectsForAgent(agentId)[0]?.repoPath ?? null;
  }

  /**
   * The *workspace* dir bound into an agent's sandbox at `/project` — the dir
   * holding every repo of the agent's project as a subdir. Null when the agent
   * belongs to no project. Like {@link repoPathForAgent}, the most recently
   * created project wins when the agent is in several.
   */
  workspacePathForAgent(agentId: string): string | null {
    return this.projectsForAgent(agentId)[0]?.workspacePath ?? null;
  }

  /** The repos of the agent's project (most recent project wins), primary first. */
  reposForAgent(agentId: string): ProjectRepo[] {
    const project = this.projectsForAgent(agentId)[0];
    return project ? this.listRepos(project.id) : [];
  }

  // --- Per-project team (role → agent) ------------------------------------

  /** Record (or update) the agent that fills a pipeline role for a project. */
  setTeamRole(projectId: string, role: string, agentId: string): void {
    this.control.db
      .insert(controlSchema.projectTeam)
      .values({ projectId, role, agentId, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [controlSchema.projectTeam.projectId, controlSchema.projectTeam.role],
        set: { agentId },
      })
      .run();
  }

  /** The project's role → agentId map. */
  getTeam(projectId: string): Array<{ role: string; agentId: string }> {
    return this.control.db
      .select({ role: controlSchema.projectTeam.role, agentId: controlSchema.projectTeam.agentId })
      .from(controlSchema.projectTeam)
      .where(eq(controlSchema.projectTeam.projectId, projectId))
      .all();
  }

  /** The agent filling a given role for a project, or null. */
  agentForRole(projectId: string, role: string): string | null {
    return (
      this.control.db
        .select({ agentId: controlSchema.projectTeam.agentId })
        .from(controlSchema.projectTeam)
        .where(
          and(
            eq(controlSchema.projectTeam.projectId, projectId),
            eq(controlSchema.projectTeam.role, role)
          )
        )
        .get()?.agentId ?? null
    );
  }

  clearTeam(projectId: string): void {
    this.control.db
      .delete(controlSchema.projectTeam)
      .where(eq(controlSchema.projectTeam.projectId, projectId))
      .run();
  }

  // --- Host-side git operations (credentials never enter the sandbox) -------

  /**
   * Replace the project's working tree with a fresh clone of `authedUrl`. For
   * HTTPS this carries an embedded token (rewritten to `plainUrl` afterward so
   * it isn't persisted); for SSH it's the ssh_url and `ctx.sshKeyPath` provides
   * auth. The committer + commit-signing config is applied after cloning.
   */
  cloneInto(repoPath: string, authedUrl: string, plainUrl: string, ctx: GitContext = {}): GitOpResult {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true });
    mkdirSync(repoPath, { recursive: true });
    const clone = this.git(repoPath, ["clone", authedUrl, "."], ctx);
    if (!clone.ok) return clone;
    this.git(repoPath, ["remote", "set-url", "origin", plainUrl]);
    this.configureRepo(repoPath, ctx);
    return clone;
  }

  /** Whether a repo's working tree has uncommitted changes (staged or not). */
  hasChanges(repoPath: string): boolean {
    const status = this.git(repoPath, ["status", "--porcelain"]);
    return status.ok && status.output.trim() !== "";
  }

  /** Create (or switch to) a branch. */
  ensureBranch(repoPath: string, branch: string): GitOpResult {
    const exists = this.git(repoPath, ["rev-parse", "--verify", branch]).ok;
    return this.git(repoPath, exists ? ["checkout", branch] : ["checkout", "-b", branch]);
  }

  /** Stage everything and commit; ok:false output "nothing to commit" when clean. */
  commitAll(repoPath: string, message: string, ctx: GitContext = {}): GitOpResult {
    this.configureRepo(repoPath, ctx);
    this.git(repoPath, ["add", "-A"]);
    const status = this.git(repoPath, ["status", "--porcelain"]);
    if (status.ok && status.output.trim() === "") {
      return { ok: false, output: "nothing to commit" };
    }
    // commit.gpgsign (set by configureRepo when signing) makes this sign.
    return this.git(repoPath, ["commit", "-m", message], ctx);
  }

  /** Push a branch to `authedUrl`, using `ctx` transport (token or SSH key). */
  push(repoPath: string, authedUrl: string, branch: string, ctx: GitContext = {}): GitOpResult {
    return this.git(repoPath, ["push", authedUrl, `HEAD:refs/heads/${branch}`], ctx);
  }

  /** Apply committer identity and (optionally) SSH commit signing to a repo. */
  private configureRepo(repoPath: string, ctx: GitContext): void {
    const name = ctx.committer?.name ?? GIT_USER_NAME;
    const email = ctx.committer?.email ?? GIT_USER_EMAIL;
    this.git(repoPath, ["config", "user.name", name]);
    this.git(repoPath, ["config", "user.email", email]);
    if (ctx.signingKeyPath) {
      this.git(repoPath, ["config", "gpg.format", "ssh"]);
      this.git(repoPath, ["config", "user.signingkey", ctx.signingKeyPath]);
      this.git(repoPath, ["config", "commit.gpgsign", "true"]);
    } else {
      this.git(repoPath, ["config", "commit.gpgsign", "false"]);
    }
  }

  /** Build the env for a git command, wiring SSH key/known-hosts when present. */
  private gitEnv(ctx: GitContext): NodeJS.ProcessEnv {
    if (!ctx.sshKeyPath) return process.env;
    const known = ctx.knownHostsPath
      ? `-o UserKnownHostsFile=${ctx.knownHostsPath}`
      : "";
    const sshCommand = `ssh -i ${ctx.sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new ${known}`.trim();
    return { ...process.env, GIT_SSH_COMMAND: sshCommand };
  }

  /** Run a git command in a repo, capturing combined output. */
  private git(repoPath: string, args: string[], ctx: GitContext = {}): GitOpResult {
    const r = spawnSync("git", ["-C", repoPath, ...args], {
      timeout: 120_000,
      encoding: "utf8",
      env: this.gitEnv(ctx),
    });
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.error) return { ok: false, output: r.error.message };
    return { ok: r.status === 0, output };
  }

  /** `git init` a fresh repo and stamp a default identity for in-sandbox commits. */
  private gitInit(repoPath: string): void {
    if (existsSync(join(repoPath, ".git"))) return;
    const run = (args: string[]) =>
      spawnSync("git", ["-C", repoPath, ...args], { timeout: 30_000, stdio: "ignore" });
    const init = run(["init"]);
    if (init.error || init.status !== 0) {
      // Git missing or failed — surface it; the project tree is still usable as
      // a plain shared directory, but collaboration via git won't work.
      console.warn(`[projects] git init failed for ${repoPath}: ${init.error?.message ?? init.status}`);
      return;
    }
    run(["config", "user.name", GIT_USER_NAME]);
    run(["config", "user.email", GIT_USER_EMAIL]);
  }
}
