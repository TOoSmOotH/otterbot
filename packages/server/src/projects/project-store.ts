import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
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

export interface Project {
  id: string;
  name: string;
  /** Absolute path to the project's git working tree on the host. */
  repoPath: string;
  /** Where the code lives. */
  mode: "local" | "existing" | "new";
  /** Forge account id (forge_accounts.id) when mode != local. */
  forgeAccountId: string | null;
  /** owner/name on the forge when mode != local. */
  forgeRepo: string | null;
  /** Base/integration branch PRs target. */
  baseBranch: string | null;
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: boolean;
  createdAt: string;
}

/** Result of a host-side git operation. */
export interface GitOpResult {
  ok: boolean;
  output: string;
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

  /** Create a project: scaffold its repo directory, `git init`, persist the row. */
  create(name: string): Project {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Project name is required.");
    const id = nanoid();
    const repoPath = resolve(this.projectsRoot, id, "repo");
    mkdirSync(repoPath, { recursive: true });
    this.gitInit(repoPath);

    const createdAt = new Date().toISOString();
    this.control.db
      .insert(controlSchema.projects)
      .values({ id, name: trimmed, repoPath, createdAt })
      .run();
    return this.get(id)!;
  }

  /** Update a project's forge configuration. */
  setForge(
    projectId: string,
    patch: Partial<
      Pick<Project, "mode" | "forgeAccountId" | "forgeRepo" | "baseBranch" | "monitorIssues">
    >
  ): void {
    this.control.db
      .update(controlSchema.projects)
      .set(patch)
      .where(eq(controlSchema.projects.id, projectId))
      .run();
  }

  /** Projects with issue-monitoring enabled (for the poller). */
  listMonitored(): Project[] {
    return this.list().filter((p) => p.monitorIssues && p.forgeAccountId && p.forgeRepo);
  }

  list(): Project[] {
    return this.control.db.select().from(controlSchema.projects).all();
  }

  get(id: string): Project | null {
    return (
      this.control.db
        .select()
        .from(controlSchema.projects)
        .where(eq(controlSchema.projects.id, id))
        .get() ?? null
    );
  }

  /** Delete a project: remove its members, row, and on-disk tree. */
  delete(id: string): void {
    const project = this.get(id);
    this.control.db
      .delete(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.projectId, id))
      .run();
    this.control.db.delete(controlSchema.projects).where(eq(controlSchema.projects.id, id)).run();
    if (project) {
      // Remove the whole `<projectsRoot>/<id>` dir, not just `repo`.
      const dir = resolve(this.projectsRoot, id);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Add an agent to a project (idempotent). */
  addMember(projectId: string, agentId: string): void {
    if (!this.get(projectId)) throw new Error(`Unknown project: ${projectId}`);
    this.control.db
      .insert(controlSchema.projectMembers)
      .values({ projectId, agentId, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
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
   * Replace the project's working tree with a fresh clone of `authedUrl` (an
   * https URL with an embedded token). Used when a project is backed by an
   * existing forge repo. The tokened remote is rewritten to the plain URL after
   * cloning so it isn't persisted in `.git/config`.
   */
  cloneInto(repoPath: string, authedUrl: string, plainUrl: string): GitOpResult {
    if (existsSync(repoPath)) rmSync(repoPath, { recursive: true, force: true });
    mkdirSync(repoPath, { recursive: true });
    const clone = this.git(repoPath, ["clone", authedUrl, "."]);
    if (!clone.ok) return clone;
    this.git(repoPath, ["remote", "set-url", "origin", plainUrl]);
    this.git(repoPath, ["config", "user.name", GIT_USER_NAME]);
    this.git(repoPath, ["config", "user.email", GIT_USER_EMAIL]);
    return clone;
  }

  /** Create (or switch to) a branch. */
  ensureBranch(repoPath: string, branch: string): GitOpResult {
    const exists = this.git(repoPath, ["rev-parse", "--verify", branch]).ok;
    return this.git(repoPath, exists ? ["checkout", branch] : ["checkout", "-b", branch]);
  }

  /** Stage everything and commit; ok:false output "nothing to commit" when clean. */
  commitAll(repoPath: string, message: string): GitOpResult {
    this.git(repoPath, ["add", "-A"]);
    const status = this.git(repoPath, ["status", "--porcelain"]);
    if (status.ok && status.output.trim() === "") {
      return { ok: false, output: "nothing to commit" };
    }
    return this.git(repoPath, ["commit", "-m", message]);
  }

  /** Push a branch to `authedUrl` (tokened https), without persisting the token. */
  push(repoPath: string, authedUrl: string, branch: string): GitOpResult {
    return this.git(repoPath, ["push", authedUrl, `HEAD:refs/heads/${branch}`]);
  }

  /** Run a git command in a repo, capturing combined output. */
  private git(repoPath: string, args: string[]): GitOpResult {
    const r = spawnSync("git", ["-C", repoPath, ...args], {
      timeout: 120_000,
      encoding: "utf8",
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
