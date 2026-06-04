import { join } from "node:path";
import { realGit, type GitRunner } from "./git-runner.js";

export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
}

/**
 * Creates and removes one git worktree (and its branch) per build-graph task, so
 * parallel coders edit isolated checkouts of the same repo. Worktrees live under
 * `<worktreeRoot>/<taskId>`; the branch is `task/<runId>/<taskId>`.
 */
export class WorktreeManager {
  constructor(
    private readonly repoPath: string,
    private readonly worktreeRoot: string,
    private readonly git: GitRunner = realGit
  ) {}

  branchName(runId: string, taskId: string): string {
    return `task/${runId}/${taskId}`;
  }

  /** Create a worktree for a task, branched off `baseBranch`. */
  add(runId: string, taskId: string, baseBranch: string): WorktreeInfo {
    const branch = this.branchName(runId, taskId);
    const path = join(this.worktreeRoot, taskId);
    const r = this.git(this.repoPath, ["worktree", "add", "-b", branch, path, baseBranch]);
    if (!r.ok) throw new Error(`worktree add failed for ${taskId}: ${r.output}`);
    return { taskId, path, branch };
  }

  /** Remove a task's worktree (force: drop even if it has uncommitted changes). */
  remove(taskId: string): void {
    const path = join(this.worktreeRoot, taskId);
    this.git(this.repoPath, ["worktree", "remove", "--force", path]);
  }

  /** Absolute paths of the repo's current worktrees (includes the main checkout). */
  list(): string[] {
    const r = this.git(this.repoPath, ["worktree", "list", "--porcelain"]);
    if (!r.ok) return [];
    return r.output
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice("worktree ".length).trim());
  }
}
