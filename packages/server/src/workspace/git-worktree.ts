import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  message: string;
}

export interface WorktreeInfo {
  agentId: string;
  branchName: string;
  worktreePath: string;
  ahead: number;
  behind: number;
}

export class GitWorktreeManager {
  private repoPath: string;
  private worktreesDir: string;

  constructor(repoPath: string, worktreesDir: string) {
    this.repoPath = repoPath;
    this.worktreesDir = worktreesDir;
  }

  /** Initialize a bare git repo with an initial commit on main */
  initRepo(): void {
    mkdirSync(this.repoPath, { recursive: true });
    this.git(["init", "-b", "main"], this.repoPath);
    // Create initial commit so branches have a base
    this.git(["commit", "--allow-empty", "-m", "Initial commit"], this.repoPath);
  }

  /** Check if the repo directory exists and is a git repo */
  hasRepo(): boolean {
    return existsSync(resolve(this.repoPath, ".git"));
  }

  /** Create a worktree for an agent, branched off main */
  createWorktree(agentId: string): WorktreeInfo {
    mkdirSync(this.worktreesDir, { recursive: true });
    const branchName = `worker/${agentId}`;
    const worktreePath = resolve(this.worktreesDir, agentId);

    this.git(
      ["worktree", "add", "-b", branchName, worktreePath, "main"],
      this.repoPath,
    );

    return {
      agentId,
      branchName,
      worktreePath,
      ahead: 0,
      behind: 0,
    };
  }

  /** Auto-commit all changes in a worktree and merge its branch into main */
  mergeBranch(agentId: string): MergeResult {
    const branchName = `worker/${agentId}`;
    const worktreePath = resolve(this.worktreesDir, agentId);

    // Auto-commit any uncommitted changes in the worktree
    this.autoCommit(worktreePath, `Auto-commit: worker ${agentId}`);

    // Check if branch has any commits ahead of main
    const ahead = this.getAheadBehind(branchName).ahead;
    if (ahead === 0) {
      return { success: true, message: "Nothing to merge — branch is up to date with main." };
    }

    // Merge into main from the main repo
    try {
      this.git(["merge", "--no-ff", "-m", `Merge ${branchName}`, branchName], this.repoPath);
      return { success: true, message: `Merged ${branchName} into main (${ahead} commit(s)).` };
    } catch (err) {
      // Merge conflict — abort and report
      this.git(["merge", "--abort"], this.repoPath);
      const conflicts = this.getConflictFiles(branchName);
      return {
        success: false,
        conflicts,
        message: `Merge conflict merging ${branchName} into main. Conflicting files: ${conflicts.join(", ")}`,
      };
    }
  }

  /** Rebase a worker's branch onto the latest main (mid-task sync) */
  updateWorktree(agentId: string): MergeResult {
    const worktreePath = resolve(this.worktreesDir, agentId);

    // Auto-commit before rebase so no dirty-tree issues
    this.autoCommit(worktreePath, `Auto-commit before sync: worker ${agentId}`);

    try {
      this.git(["rebase", "main"], worktreePath);
      return { success: true, message: `Rebased worker/${agentId} onto main.` };
    } catch {
      this.git(["rebase", "--abort"], worktreePath);
      return {
        success: false,
        message: `Rebase conflict for worker/${agentId}. Branch left unchanged.`,
      };
    }
  }

  /** Remove a worktree and delete its branch */
  destroyWorktree(agentId: string): void {
    const branchName = `worker/${agentId}`;
    const worktreePath = resolve(this.worktreesDir, agentId);

    if (existsSync(worktreePath)) {
      this.git(["worktree", "remove", "--force", worktreePath], this.repoPath);
    }

    // Clean up the branch (may already be gone)
    try {
      this.git(["branch", "-D", branchName], this.repoPath);
    } catch {
      // Branch may not exist if already deleted
    }
  }

  /** Get a diff summary for a worker's branch vs main */
  getBranchDiff(agentId: string): string {
    const branchName = `worker/${agentId}`;
    try {
      return this.git(["diff", "--stat", `main...${branchName}`], this.repoPath);
    } catch {
      return "(no diff available)";
    }
  }

  /** Get the status of a worker's worktree (uncommitted changes) */
  getBranchStatus(agentId: string): string {
    const worktreePath = resolve(this.worktreesDir, agentId);
    try {
      return this.git(["status", "--short"], worktreePath);
    } catch {
      return "(status unavailable)";
    }
  }

  /** List all active worktrees */
  listWorktrees(): WorktreeInfo[] {
    const raw = this.git(["worktree", "list", "--porcelain"], this.repoPath);
    const entries: WorktreeInfo[] = [];
    const blocks = raw.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      const branchLine = lines.find((l) => l.startsWith("branch "));
      if (!branchLine) continue;

      const branchRef = branchLine.replace("branch ", "").trim();
      // Skip the main worktree
      if (branchRef === "refs/heads/main") continue;

      const branchName = branchRef.replace("refs/heads/", "");
      const agentId = branchName.replace("worker/", "");
      const worktreePath = lines[0]?.replace("worktree ", "").trim() ?? "";

      const { ahead, behind } = this.getAheadBehind(branchName);
      entries.push({ agentId, branchName, worktreePath, ahead, behind });
    }

    return entries;
  }

  /** Get info for a specific worktree */
  getWorktree(agentId: string): WorktreeInfo | null {
    const branchName = `worker/${agentId}`;
    const worktreePath = resolve(this.worktreesDir, agentId);
    if (!existsSync(worktreePath)) return null;

    const { ahead, behind } = this.getAheadBehind(branchName);
    return { agentId, branchName, worktreePath, ahead, behind };
  }

  /** Commit all changes in a worktree with a custom message */
  commit(worktreePath: string, message: string): boolean {
    try {
      this.git(["add", "-A"], worktreePath);
      const status = this.git(["status", "--porcelain"], worktreePath);
      if (!status.trim()) return false; // Nothing to commit
      this.git(["commit", "-m", message], worktreePath);
      return true;
    } catch {
      return false;
    }
  }

  // --- private helpers ---

  private autoCommit(worktreePath: string, message: string): void {
    this.git(["add", "-A"], worktreePath);
    const status = this.git(["status", "--porcelain"], worktreePath);
    if (status.trim()) {
      this.git(["commit", "-m", message], worktreePath);
    }
  }

  private getAheadBehind(branchName: string): { ahead: number; behind: number } {
    try {
      const raw = this.git(
        ["rev-list", "--left-right", "--count", `main...${branchName}`],
        this.repoPath,
      );
      const [behind, ahead] = raw.trim().split(/\s+/).map(Number);
      return { ahead: ahead ?? 0, behind: behind ?? 0 };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  private getConflictFiles(branchName: string): string[] {
    try {
      // Do a trial merge to find conflicts without committing
      this.git(["merge", "--no-commit", "--no-ff", branchName], this.repoPath);
      this.git(["merge", "--abort"], this.repoPath);
      return [];
    } catch {
      try {
        const raw = this.git(["diff", "--name-only", "--diff-filter=U"], this.repoPath);
        this.git(["merge", "--abort"], this.repoPath);
        return raw.trim().split("\n").filter(Boolean);
      } catch {
        try { this.git(["merge", "--abort"], this.repoPath); } catch { /* already clean */ }
        return ["(unable to determine conflicting files)"];
      }
    }
  }

  private git(args: string[], cwd: string): string {
    const result = execFileSync("git", args, {
      cwd,
      stdio: "pipe",
      timeout: 30_000,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Smoothbot",
        GIT_AUTHOR_EMAIL: "bot@smoothbot.local",
        GIT_COMMITTER_NAME: "Smoothbot",
        GIT_COMMITTER_EMAIL: "bot@smoothbot.local",
      },
    });
    return result.toString();
  }
}
