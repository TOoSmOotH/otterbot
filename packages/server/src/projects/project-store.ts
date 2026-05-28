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
  createdAt: string;
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
    return { id, name: trimmed, repoPath, createdAt };
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
