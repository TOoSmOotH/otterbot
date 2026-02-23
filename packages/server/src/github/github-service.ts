import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../auth/auth.js";

// Input validation patterns
const REPO_NAME_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9._\/-]+$/;

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  assignees: { login: string }[];
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  user: { login: string };
  labels: { name: string }[];
  assignees: { login: string }[];
  merged: boolean;
  mergeable: boolean | null;
  created_at: string;
  updated_at: string;
}

/**
 * Build environment variables for git commands that use a PAT for authentication.
 * The PAT is passed via GIT_PAT env var and consumed by the inline credential helper.
 */
function gitEnvWithPAT(token: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAT: token,
  };
}

/**
 * Build git config args for an inline credential helper that uses the GIT_PAT env var.
 * This keeps the token out of .git/config and remote URLs.
 * Returns an array of arguments for use with execFileSync.
 */
function gitCredentialArgs(): string[] {
  return ["-c", `credential.helper=!f() { echo username=x-access-token; echo password=$GIT_PAT; }; f`];
}

function validateRepoName(name: string): void {
  if (!REPO_NAME_RE.test(name)) {
    throw new Error(`Invalid repository name: ${name}`);
  }
}

function validateBranchName(name: string): void {
  if (!BRANCH_NAME_RE.test(name)) {
    throw new Error(`Invalid branch name: ${name}`);
  }
}

/**
 * Configure git user identity in a cloned repo.
 */
function configureGitUser(targetDir: string): void {
  const userName = getConfig("github:username") ?? "otterbot";
  const userEmail =
    getConfig("github:email") ?? `${userName}@users.noreply.github.com`;
  execFileSync("git", ["-C", targetDir, "config", "user.name", userName], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", targetDir, "config", "user.email", userEmail], {
    stdio: "pipe",
  });
}

/**
 * Clone a GitHub repo into targetDir, optionally checking out a branch.
 * Tries HTTPS+PAT first (if a token is configured), then falls back to SSH
 * (if ~/.ssh/otterbot_github exists).
 */
export function cloneRepo(
  repoFullName: string,
  targetDir: string,
  branch?: string,
): void {
  validateRepoName(repoFullName);
  if (branch) validateBranchName(branch);

  const token = getConfig("github:token") as string | undefined;
  const sshKeyPath = join(homedir(), ".ssh", "otterbot_github");
  const sshKeyExists = existsSync(sshKeyPath);

  if (existsSync(targetDir + "/.git")) {
    // Already cloned — fetch and checkout using whatever remote is configured
    const fetchOpts: { stdio: "pipe"; timeout: number; env?: Record<string, string> } = {
      stdio: "pipe",
      timeout: 120_000,
    };
    if (token) {
      fetchOpts.env = gitEnvWithPAT(token);
    }
    const fetchArgs = [
      ...(token ? gitCredentialArgs() : []),
      "-C", targetDir, "fetch", "--all",
    ];
    execFileSync("git", fetchArgs, fetchOpts);
    if (branch) {
      execFileSync("git", ["-C", targetDir, "checkout", branch], {
        stdio: "pipe",
        timeout: 30_000,
      });
      const pullOpts: { stdio: "pipe"; timeout: number; env?: Record<string, string> } = {
        stdio: "pipe",
        timeout: 120_000,
      };
      if (token) {
        pullOpts.env = gitEnvWithPAT(token);
      }
      const pullArgs = [
        ...(token ? gitCredentialArgs() : []),
        "-C", targetDir, "pull", "origin", branch,
      ];
      execFileSync("git", pullArgs, pullOpts);
    }
    return;
  }

  const branchArgs = branch ? ["--branch", branch] : [];
  let httpsErr: unknown;

  // Try HTTPS+PAT first
  if (token) {
    const httpsUrl = `https://github.com/${repoFullName}.git`;
    try {
      execFileSync(
        "git",
        ["clone", ...gitCredentialArgs(), ...branchArgs, httpsUrl, targetDir],
        {
          stdio: "pipe",
          timeout: 300_000,
          env: gitEnvWithPAT(token),
        },
      );
      configureGitUser(targetDir);
      return;
    } catch (err) {
      httpsErr = err;
      // HTTPS failed — fall through to SSH
    }
  }

  // Fall back to SSH
  if (sshKeyExists) {
    const sshUrl = `git@github.com:${repoFullName}.git`;
    execFileSync("git", ["clone", ...branchArgs, sshUrl, targetDir], {
      stdio: "pipe",
      timeout: 300_000,
      env: { ...process.env },
    });
    configureGitUser(targetDir);
    return;
  }

  // Neither method worked
  if (httpsErr) {
    const msg = httpsErr instanceof Error ? httpsErr.message : String(httpsErr);
    throw new Error(
      `Could not clone ${repoFullName}: HTTPS+PAT failed (${msg}), and no SSH key found at ${sshKeyPath}`,
    );
  }
  throw new Error(
    `Could not clone ${repoFullName}: no GitHub PAT configured and no SSH key found at ${sshKeyPath}`,
  );
}

/**
 * Get the default branch of a repo from the GitHub API.
 */
export async function getRepoDefaultBranch(
  repoFullName: string,
  token: string,
): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

/**
 * Fetch open issues assigned to a user, optionally filtering by `since`.
 */
export async function fetchAssignedIssues(
  repoFullName: string,
  token: string,
  assignee: string,
  since?: string,
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams({
    assignee,
    state: "open",
    per_page: "100",
  });
  if (since) params.set("since", since);

  const res = await fetch(
    `https://api.github.com/repos/${repoFullName}/issues?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  const issues = (await res.json()) as GitHubIssue[];
  // Filter out pull requests (GitHub API returns PRs as issues)
  return issues
    .filter((i) => !(i as any).pull_request)
    .filter((i) =>
      i.assignees.some((a) => a.login.toLowerCase() === assignee.toLowerCase()),
    );
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

const GITHUB_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
});

async function ghFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...GITHUB_HEADERS(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Issue APIs
// ---------------------------------------------------------------------------

/**
 * Fetch a single issue by number, including its body.
 */
export async function fetchIssue(
  repoFullName: string,
  token: string,
  issueNumber: number,
): Promise<GitHubIssue> {
  return ghFetch<GitHubIssue>(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}`,
    token,
  );
}

/**
 * Fetch comments on an issue (or PR — same endpoint).
 */
export async function fetchIssueComments(
  repoFullName: string,
  token: string,
  issueNumber: number,
): Promise<GitHubComment[]> {
  return ghFetch<GitHubComment[]>(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments?per_page=100`,
    token,
  );
}

export interface FetchIssuesOpts {
  state?: "open" | "closed" | "all";
  labels?: string;
  assignee?: string;
  per_page?: number;
}

/**
 * List issues with optional filters.
 */
export async function fetchIssues(
  repoFullName: string,
  token: string,
  opts?: FetchIssuesOpts,
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams();
  if (opts?.state) params.set("state", opts.state);
  if (opts?.labels) params.set("labels", opts.labels);
  if (opts?.assignee) params.set("assignee", opts.assignee);
  params.set("per_page", String(opts?.per_page ?? 30));

  const issues = await ghFetch<(GitHubIssue & { pull_request?: unknown })[]>(
    `https://api.github.com/repos/${repoFullName}/issues?${params}`,
    token,
  );
  // Filter out pull requests (GitHub API returns PRs as issues)
  return issues.filter((i) => !i.pull_request);
}

/**
 * Post a comment on an issue or pull request.
 */
export async function createIssueComment(
  repoFullName: string,
  token: string,
  issueNumber: number,
  body: string,
): Promise<GitHubComment> {
  return ghFetch<GitHubComment>(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/comments`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

/**
 * Add labels to an issue (creates labels if they don't exist).
 */
export async function addLabelsToIssue(
  repoFullName: string,
  token: string,
  issueNumber: number,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) return;
  await ghFetch<unknown>(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/labels`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labels }),
    },
  );
}

/**
 * Remove a single label from an issue.
 */
export async function removeLabelFromIssue(
  repoFullName: string,
  token: string,
  issueNumber: number,
  label: string,
): Promise<void> {
  await ghFetch<unknown>(
    `https://api.github.com/repos/${repoFullName}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
    token,
    { method: "DELETE" },
  );
}

/**
 * Fetch open issues with optional filters (no assignee filter by default).
 * Returns up to one page (100 issues). Use fetchAllOpenIssueNumbers()
 * when you need an authoritative set of all open issue numbers.
 */
export async function fetchOpenIssues(
  repoFullName: string,
  token: string,
  since?: string,
): Promise<GitHubIssue[]> {
  const params = new URLSearchParams({
    state: "open",
    per_page: "100",
  });
  if (since) params.set("since", since);

  const issues = await ghFetch<(GitHubIssue & { pull_request?: unknown })[]>(
    `https://api.github.com/repos/${repoFullName}/issues?${params}`,
    token,
  );
  // Filter out pull requests (GitHub API returns PRs as issues)
  return issues.filter((i) => !i.pull_request);
}

/**
 * Fetch ALL open issue numbers via pagination.
 * Only retrieves the minimal fields needed (number) to build an authoritative set.
 * Much cheaper than fetching full issue bodies for every page.
 */
export async function fetchAllOpenIssueNumbers(
  repoFullName: string,
  token: string,
): Promise<Set<number>> {
  const numbers = new Set<number>();
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      state: "open",
      per_page: "100",
      page: String(page),
    });

    const issues = await ghFetch<{ number: number; pull_request?: unknown }[]>(
      `https://api.github.com/repos/${repoFullName}/issues?${params}`,
      token,
    );

    for (const issue of issues) {
      if (!issue.pull_request) numbers.add(issue.number);
    }

    if (issues.length < 100) break;
    page++;
  }

  return numbers;
}

// ---------------------------------------------------------------------------
// Pull Request APIs
// ---------------------------------------------------------------------------

/**
 * Fetch a single pull request by number.
 */
export async function fetchPullRequest(
  repoFullName: string,
  token: string,
  prNumber: number,
): Promise<GitHubPullRequest> {
  return ghFetch<GitHubPullRequest>(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}`,
    token,
  );
}

export interface FetchPullRequestsOpts {
  state?: "open" | "closed" | "all";
  per_page?: number;
}

/**
 * List pull requests with optional filters.
 */
export async function fetchPullRequests(
  repoFullName: string,
  token: string,
  opts?: FetchPullRequestsOpts,
): Promise<GitHubPullRequest[]> {
  const params = new URLSearchParams();
  if (opts?.state) params.set("state", opts.state);
  params.set("per_page", String(opts?.per_page ?? 30));

  return ghFetch<GitHubPullRequest[]>(
    `https://api.github.com/repos/${repoFullName}/pulls?${params}`,
    token,
  );
}

// ---------------------------------------------------------------------------
// Pull Request Review APIs
// ---------------------------------------------------------------------------

export interface GitHubReview {
  id: number;
  user: { login: string };
  body: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  submitted_at: string;
  html_url: string;
}

export interface GitHubReviewComment {
  id: number;
  user: { login: string };
  body: string;
  path: string;
  line: number | null;
  diff_hunk: string;
  created_at: string;
}

/**
 * Fetch reviews on a pull request.
 */
export async function fetchPullRequestReviews(
  repoFullName: string,
  token: string,
  prNumber: number,
): Promise<GitHubReview[]> {
  return ghFetch<GitHubReview[]>(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/reviews?per_page=100`,
    token,
  );
}

/**
 * Fetch review comments (inline/diff comments) on a pull request.
 */
export async function fetchPullRequestReviewComments(
  repoFullName: string,
  token: string,
  prNumber: number,
): Promise<GitHubReviewComment[]> {
  return ghFetch<GitHubReviewComment[]>(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/comments?per_page=100`,
    token,
  );
}

/**
 * Request reviewers on a pull request.
 */
export async function requestPullRequestReviewers(
  repoFullName: string,
  token: string,
  prNumber: number,
  reviewers: string[],
): Promise<void> {
  await ghFetch<unknown>(
    `https://api.github.com/repos/${repoFullName}/pulls/${prNumber}/requested_reviewers`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewers }),
    },
  );
}

/**
 * Fetch the diff (changed files with patches) between two refs using the Compare API.
 */
export async function fetchCompareCommitsDiff(
  repoFullName: string,
  token: string,
  base: string,
  head: string,
): Promise<{ filename: string; status: string; patch?: string }[]> {
  validateRepoName(repoFullName);
  validateBranchName(base);
  validateBranchName(head);

  const data = await ghFetch<{
    files?: { filename: string; status: string; patch?: string }[];
  }>(
    `https://api.github.com/repos/${repoFullName}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
  );
  return (data.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status,
    patch: f.patch,
  }));
}

/**
 * Create a pull request.
 */
export async function createPullRequest(
  repoFullName: string,
  token: string,
  head: string,
  base: string,
  title: string,
  body?: string,
): Promise<GitHubPullRequest> {
  return ghFetch<GitHubPullRequest>(
    `https://api.github.com/repos/${repoFullName}/pulls`,
    token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ head, base, title, body }),
    },
  );
}
