
import { execSync, execFileSync } from "node:child_process";
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
    execSync("git init -b main", { cwd, stdio: "ignore" });
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
 * Check if a git remote exists.
 */
export function hasRemote(cwd: string, remoteName = "origin"): boolean {
  try {
    execSync(`git remote get-url ${remoteName}`, { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
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
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoPath, stdio: "ignore" });
    } catch {
        // Fallback to manual removal
        rmSync(worktreePath, { recursive: true, force: true });
        execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
    }
  }

  // Only fetch from remote if one exists
  const remoteAvailable = hasRemote(repoPath);
  if (remoteAvailable) {
    try {
      if (sourceBranch) {
        execSync(`git fetch origin "${sourceBranch}"`, { cwd: repoPath, stdio: "ignore" });
      } else {
        execSync("git fetch origin", { cwd: repoPath, stdio: "ignore" });
      }
    } catch { /* best effort — remote may be unavailable */ }
  }

  // Determine the start point: source branch (for kickbacks/iterations) or latest HEAD
  // When no source branch is specified, prefer the fetched remote HEAD over the
  // potentially stale local HEAD so workers always start with up-to-date code.
  let startPoint: string;
  if (sourceBranch && remoteAvailable) {
    startPoint = `origin/${sourceBranch}`;
  } else if (sourceBranch) {
    // Local-only repo: use the local source branch directly
    startPoint = sourceBranch;
  } else if (remoteAvailable) {
    // Use the remote default branch if available, otherwise fall back to local HEAD
    try {
      const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
        cwd: repoPath, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"],
      }).trim().replace("refs/remotes/", "");
      startPoint = defaultBranch; // e.g. "origin/main"
    } catch {
      startPoint = "HEAD";
    }
  } else {
    startPoint = "HEAD";
  }
  // For source branches, try the remote ref first; fall back to local ref
  const startPointFallback = sourceBranch ?? "HEAD";

  // Create worktree
  // -f: force creation
  // -B: create/reset branch
  try {
    execSync(`git worktree add -f -B "${branchName}" "${worktreePath}" "${startPoint}"`, { cwd: repoPath, stdio: "ignore" });
  } catch (error) {
    // Prune and retry — also fall back to local ref if remote ref failed
    execSync("git worktree prune", { cwd: repoPath, stdio: "ignore" });
    execSync(`git worktree add -f -B "${branchName}" "${worktreePath}" "${startPointFallback}"`, { cwd: repoPath, stdio: "ignore" });
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
        execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoPath, stdio: "ignore" });
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

// ---------------------------------------------------------------------------
// Git diff utilities
// ---------------------------------------------------------------------------

export interface GitDiffFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface GitDiffResult {
  files: GitDiffFile[];
}

/**
 * Parse `git diff --numstat` output into structured file entries.
 */
export function parseNumstat(output: string): GitDiffFile[] {
  if (!output) return [];

  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const path = parts[2]!;
      if (!path) return null;
      return {
        path,
        additions: parseInt(parts[0] ?? "0", 10) || 0,
        deletions: parseInt(parts[1] ?? "0", 10) || 0,
      };
    })
    .filter((f): f is GitDiffFile => f !== null);
}

/**
 * Find the merge-base (branch point) for the current branch.
 * Tries upstream tracking ref first, then common default branches.
 * Returns the merge-base commit hash, or null if it can't be determined.
 */
export function findMergeBase(cwd: string): string | null {
  // Try upstream tracking ref first
  try {
    const upstream = execSync("git rev-parse --abbrev-ref @{u}", {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (upstream) {
      const base = execSync(`git merge-base ${upstream} HEAD`, {
        cwd,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (base) return base;
    }
  } catch {
    // No upstream tracking — fall through
  }

  // Try common remote default branches, then local branches (for local-only repos)
  for (const ref of ["origin/dev", "origin/main", "origin/master", "dev", "main", "master"]) {
    try {
      const base = execSync(`git merge-base ${ref} HEAD`, {
        cwd,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (base) return base;
    } catch {
      // ref doesn't exist — try next
    }
  }

  return null;
}

/**
 * Compute file diffs via git in a workspace directory.
 * Checks both uncommitted changes (vs HEAD) and committed branch changes
 * (vs the merge-base), merging and deduplicating the results.
 */
export function computeGitDiff(workspacePath: string): GitDiffResult | null {
  const fileMap = new Map<string, GitDiffFile>();

  // 1. Uncommitted changes (staged + unstaged) vs HEAD
  try {
    const uncommitted = execSync("git diff --numstat HEAD", {
      cwd: workspacePath,
      encoding: "utf-8",
      timeout: 10_000,
    }).trim();

    for (const file of parseNumstat(uncommitted)) {
      fileMap.set(file.path, file);
    }
  } catch {
    // No HEAD or not a git repo — skip
  }

  // 2. Committed branch changes vs merge-base
  try {
    const mergeBase = findMergeBase(workspacePath);
    if (mergeBase) {
      const committed = execSync(`git diff --numstat ${mergeBase}..HEAD`, {
        cwd: workspacePath,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();

      for (const file of parseNumstat(committed)) {
        // Merge: if a file appears in both uncommitted and committed diffs,
        // prefer the committed diff (it includes the full branch change)
        const existing = fileMap.get(file.path);
        if (existing) {
          // Sum uncommitted on top of committed changes
          fileMap.set(file.path, {
            path: file.path,
            additions: file.additions + existing.additions,
            deletions: file.deletions + existing.deletions,
          });
        } else {
          fileMap.set(file.path, file);
        }
      }
    }
  } catch {
    // Could not determine merge-base — committed changes won't be counted
  }

  if (fileMap.size === 0) return null;
  return { files: Array.from(fileMap.values()) };
}

// ---------------------------------------------------------------------------
// Rebase utilities
// ---------------------------------------------------------------------------

/**
 * Rebase a branch onto the latest remote target branch.
 * Fetches origin, checks out the branch, and rebases onto origin/{targetBranch}.
 * Returns true on success, false on conflict (rebase is aborted).
 *
 * @param gitEnv - Environment variables for git (for PAT auth)
 * @param credentialArgs - Extra git args for credential helper
 */
export function rebaseBranch(
  cwd: string,
  branch: string,
  targetBranch: string,
  gitEnv?: Record<string, string>,
  credentialArgs?: string[],
): boolean {
  const execOpts = {
    cwd,
    stdio: "pipe" as const,
    timeout: 120_000,
    env: gitEnv,
  };
  const creds = credentialArgs ?? [];

  // Fetch latest from origin
  execFileSync("git", [...creds, "fetch", "origin"], execOpts);

  // Checkout the branch
  execFileSync("git", ["checkout", branch], { cwd, stdio: "pipe", timeout: 30_000 });

  // Attempt rebase
  try {
    execFileSync("git", ["rebase", `origin/${targetBranch}`], execOpts);
    return true;
  } catch {
    // Rebase failed — abort and return false
    try {
      execFileSync("git", ["rebase", "--abort"], { cwd, stdio: "pipe", timeout: 10_000 });
    } catch {
      // Already aborted or not in rebase state
    }
    return false;
  }
}

/**
 * Force-push a branch to origin using --force-with-lease (safe force push).
 *
 * @param gitEnv - Environment variables for git (for PAT auth)
 * @param credentialArgs - Extra git args for credential helper
 */
export function forcePushBranch(
  cwd: string,
  branch: string,
  gitEnv?: Record<string, string>,
  credentialArgs?: string[],
): void {
  const creds = credentialArgs ?? [];
  execFileSync(
    "git",
    [...creds, "push", "--force-with-lease", "origin", branch],
    {
      cwd,
      stdio: "pipe",
      timeout: 120_000,
      env: gitEnv,
    },
  );
}
