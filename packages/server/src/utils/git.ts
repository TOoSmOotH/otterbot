
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Check if a directory is a git repository.
 */
export function isGitRepo(cwd: string): boolean {
  try {
    const gitDir = join(cwd, ".git");
    return existsSync(gitDir);
  } catch {
    return false;
  }
}

/**
 * Initialize a git repository in the given directory.
 */
export function initGitRepo(cwd: string): void {
  if (!existsSync(cwd)) {
    mkdirSync(cwd, { recursive: true });
  }

  if (!isGitRepo(cwd)) {
    execSync("git init", { cwd, stdio: "ignore" });
    // Set local config to ensure commits work even if global config is missing
    execSync("git config user.email 'otterbot@example.com'", { cwd, stdio: "ignore" });
    execSync("git config user.name 'OtterBot'", { cwd, stdio: "ignore" });
  }
}

/**
 * Check if the repository has any commits.
 */
export function hasCommits(cwd: string): boolean {
  try {
    execSync("git rev-parse HEAD", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create an initial commit if the repository is empty.
 */
export function createInitialCommit(cwd: string): void {
  // Ensure we are in a git repo
  if (!isGitRepo(cwd)) {
      initGitRepo(cwd);
  }

  // If we already have commits, return
  if (hasCommits(cwd)) return;

  const readmePath = join(cwd, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, "# Project Repository\n\nManaged by OtterBot agents.");
  }

  execSync("git add .", { cwd, stdio: "ignore" });
  try {
    execSync("git commit -m 'Initial commit'", { cwd, stdio: "ignore" });
  } catch (error) {
    // If nothing to commit (e.g. empty directory), create an empty commit
    execSync("git commit --allow-empty -m 'Initial commit'", { cwd, stdio: "ignore" });
  }
}

/**
 * Create a worktree for an agent.
 * @param repoPath Path to the main repository
 * @param worktreePath Path where the worktree should be created
 * @param branchName Name of the branch to create/checkout
 */
export function createWorktree(repoPath: string, worktreePath: string, branchName: string, sourceBranch?: string): void {
  // Ensure the repo is initialized and has commits
  createInitialCommit(repoPath);

  // If worktree directory exists, remove it first to avoid conflicts
  if (existsSync(worktreePath)) {
    try {
        // Try git removal first
        execSync(`git worktree remove --force ${worktreePath}`, { cwd: repoPath, stdio: "ignore" });
    } catch {
        // Fallback to manual removal
        rmSync(worktreePath, { recursive: true, force: true });
        execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
    }
  }

  // If a source branch is specified, fetch it first so the ref exists locally
  if (sourceBranch) {
    try {
      execSync(`git fetch origin ${sourceBranch}`, { cwd: repoPath, stdio: "ignore" });
    } catch { /* best effort — branch may be local-only */ }
  }

  // Determine the start point: source branch (for kickbacks/iterations) or HEAD
  const startPoint = sourceBranch ? `origin/${sourceBranch}` : "HEAD";
  // For source branches, try the remote ref first; fall back to local ref
  const startPointFallback = sourceBranch ?? "HEAD";

  // Create worktree
  // -f: force creation
  // -B: create/reset branch
  try {
    execSync(`git worktree add -f -B ${branchName} ${worktreePath} ${startPoint}`, { cwd: repoPath, stdio: "ignore" });
  } catch (error) {
    // Prune and retry — also fall back to local ref if remote ref failed
    execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
    execSync(`git worktree add -f -B ${branchName} ${worktreePath} ${startPointFallback}`, { cwd: repoPath, stdio: "ignore" });
  }
}

/**
 * Remove a worktree.
 * @param repoPath Path to the main repository
 * @param worktreePath Path to the worktree to remove
 */
export function removeWorktree(repoPath: string, worktreePath: string): void {
  try {
    if (existsSync(worktreePath)) {
        // Force remove even if there are uncommitted changes (agent is done/destroyed)
        execSync(`git worktree remove --force ${worktreePath}`, { cwd: repoPath, stdio: "ignore" });
    }
  } catch (error) {
    // If it fails, maybe it's already gone or not a worktree.
    // Just prune worktrees
    execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });

    // Ensure directory is gone
    if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
    }
  }
}

/**
 * Get the current commit hash of the repo/worktree.
 */
export function getCommitHash(cwd: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}
