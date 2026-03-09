import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getConfig } from "../auth/auth.js";
import { getDb, schema } from "../db/index.js";
import { resolveGiteaAccount, resolveGiteaToken, resolveGiteaInstanceUrl } from "./account-resolver.js";

// Input validation patterns
const REPO_NAME_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
const BRANCH_NAME_RE = /^[a-zA-Z0-9._\/-]+$/;

export interface GiteaIssue {
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

export interface GiteaComment {
  id: number;
  user: { login: string };
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GiteaPullRequest {
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
export function gitEnvWithPAT(token: string): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAT: token,
  };
}

/**
 * Build git config args for an inline credential helper that uses the GIT_PAT env var.
 * This keeps the token out of .git/config and remote URLs.
 */
export function gitCredentialArgs(): string[] {
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
 * Normalize a Gitea instance URL: strip trailing slashes.
 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Extract the hostname from a Gitea instance URL for SSH operations.
 */
function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
  }
}

/**
 * Configure git user identity in a cloned repo.
 */
function configureGitUser(targetDir: string, projectId?: string): void {
  const account = resolveGiteaAccount(projectId);
  const userName = account?.username ?? getConfig("gitea:username") ?? "otterbot";
  const userEmail =
    account?.email ?? getConfig("gitea:email") ?? `${userName}@users.noreply.gitea.local`;
  execFileSync("git", ["-C", targetDir, "config", "user.name", userName], {
    stdio: "pipe",
  });
  execFileSync("git", ["-C", targetDir, "config", "user.email", userEmail], {
    stdio: "pipe",
  });
}

/**
 * Clone a Gitea repo into targetDir, optionally checking out a branch.
 * Uses HTTPS+PAT authentication.
 */
export function cloneRepo(
  repoFullName: string,
  targetDir: string,
  branch?: string,
  projectId?: string,
): void {
  validateRepoName(repoFullName);
  if (branch) validateBranchName(branch);

  const token = resolveGiteaToken(projectId);
  const instanceUrl = resolveGiteaInstanceUrl(projectId);

  if (!token || !instanceUrl) {
    throw new Error(
      `Could not clone ${repoFullName}: no Gitea token or instance URL configured`,
    );
  }

  const baseUrl = normalizeUrl(instanceUrl);

  if (existsSync(targetDir + "/.git")) {
    // Already cloned — fetch and checkout
    const fetchOpts: { stdio: "pipe"; timeout: number; env?: Record<string, string> } = {
      stdio: "pipe",
      timeout: 120_000,
      env: gitEnvWithPAT(token),
    };
    const fetchArgs = [
      ...gitCredentialArgs(),
      "-C", targetDir, "fetch", "--all",
    ];
    execFileSync("git", fetchArgs, fetchOpts);
    if (branch) {
      execFileSync("git", ["-C", targetDir, "checkout", branch], {
        stdio: "pipe",
        timeout: 30_000,
      });
      const pullArgs = [
        ...gitCredentialArgs(),
        "-C", targetDir, "pull", "origin", branch,
      ];
      execFileSync("git", pullArgs, {
        stdio: "pipe",
        timeout: 120_000,
        env: gitEnvWithPAT(token),
      });
    }
    return;
  }

  const branchArgs = branch ? ["--branch", branch] : [];
  const httpsUrl = `${baseUrl}/${repoFullName}.git`;

  execFileSync(
    "git",
    ["clone", ...gitCredentialArgs(), ...branchArgs, httpsUrl, targetDir],
    {
      stdio: "pipe",
      timeout: 300_000,
      env: gitEnvWithPAT(token),
    },
  );
  configureGitUser(targetDir, projectId);
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

function giteaHeaders(token: string): Record<string, string> {
  return {
    Authorization: `token ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function giteaFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...giteaHeaders(token), ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    throw new Error(`Gitea API error ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * Build the Gitea API base URL for a project.
 */
function apiBase(projectId?: string): string {
  const instanceUrl = resolveGiteaInstanceUrl(projectId);
  if (!instanceUrl) throw new Error("No Gitea instance URL configured");
  return `${normalizeUrl(instanceUrl)}/api/v1`;
}

// ---------------------------------------------------------------------------
// Repository APIs
// ---------------------------------------------------------------------------

/**
 * Get the default branch of a repo from the Gitea API.
 */
export async function getRepoDefaultBranch(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<string> {
  const base = normalizeUrl(instanceUrl);
  const res = await fetch(`${base}/api/v1/repos/${repoFullName}`, {
    headers: giteaHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`Gitea API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

export interface RepoPermissions {
  admin: boolean;
  push: boolean;
  pull: boolean;
}

/**
 * Check the authenticated user's permissions on a repository.
 */
export async function getRepoPermissions(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<RepoPermissions | null> {
  const base = normalizeUrl(instanceUrl);
  const res = await fetch(`${base}/api/v1/repos/${repoFullName}`, {
    headers: giteaHeaders(token),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data as any).permissions ?? null;
}

/**
 * Check if the authenticated user has push (write) access on a repo.
 */
export async function checkHasPushAccess(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<boolean> {
  const perms = await getRepoPermissions(repoFullName, token, instanceUrl);
  if (!perms) return false;
  return perms.push || perms.admin;
}

/**
 * Check if the authenticated user has at least pull-level access on a repo.
 * Gitea doesn't have a triage permission — use push/admin as equivalent.
 */
export async function checkHasTriageAccess(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<boolean> {
  const perms = await getRepoPermissions(repoFullName, token, instanceUrl);
  if (!perms) return false;
  return perms.push || perms.admin;
}

// ---------------------------------------------------------------------------
// Issue APIs
// ---------------------------------------------------------------------------

/**
 * Fetch a single issue by number.
 */
export async function fetchIssue(
  repoFullName: string,
  token: string,
  issueNumber: number,
  instanceUrl: string,
): Promise<GiteaIssue> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaIssue>(
    `${base}/api/v1/repos/${repoFullName}/issues/${issueNumber}`,
    token,
  );
}

/**
 * Fetch comments on an issue.
 */
export async function fetchIssueComments(
  repoFullName: string,
  token: string,
  issueNumber: number,
  instanceUrl: string,
): Promise<GiteaComment[]> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaComment[]>(
    `${base}/api/v1/repos/${repoFullName}/issues/${issueNumber}/comments`,
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
  instanceUrl: string,
  opts?: FetchIssuesOpts,
): Promise<GiteaIssue[]> {
  const base = normalizeUrl(instanceUrl);
  const params = new URLSearchParams();
  params.set("type", "issues"); // Gitea: exclude PRs
  if (opts?.state) params.set("state", opts.state);
  if (opts?.labels) params.set("labels", opts.labels);
  if (opts?.assignee) params.set("assigned_by", opts.assignee);
  params.set("limit", String(opts?.per_page ?? 30));

  return giteaFetch<GiteaIssue[]>(
    `${base}/api/v1/repos/${repoFullName}/issues?${params}`,
    token,
  );
}

/**
 * Post a comment on an issue.
 */
export async function createIssueComment(
  repoFullName: string,
  token: string,
  issueNumber: number,
  body: string,
  instanceUrl: string,
): Promise<GiteaComment> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaComment>(
    `${base}/api/v1/repos/${repoFullName}/issues/${issueNumber}/comments`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

/**
 * Add labels to an issue.
 * Gitea expects label IDs, so we first resolve label names to IDs.
 */
export async function addLabelsToIssue(
  repoFullName: string,
  token: string,
  issueNumber: number,
  labels: string[],
  instanceUrl: string,
): Promise<void> {
  if (labels.length === 0) return;
  const base = normalizeUrl(instanceUrl);

  // Resolve label names to IDs
  const existingLabels = await giteaFetch<{ id: number; name: string }[]>(
    `${base}/api/v1/repos/${repoFullName}/labels?limit=50`,
    token,
  );

  const labelIds: number[] = [];
  for (const name of labels) {
    const existing = existingLabels.find((l) => l.name === name);
    if (existing) {
      labelIds.push(existing.id);
    } else {
      // Create the label if it doesn't exist
      const created = await giteaFetch<{ id: number }>(
        `${base}/api/v1/repos/${repoFullName}/labels`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ name, color: "#0075ca" }),
        },
      );
      labelIds.push(created.id);
    }
  }

  await giteaFetch<unknown>(
    `${base}/api/v1/repos/${repoFullName}/issues/${issueNumber}/labels`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ labels: labelIds }),
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
  instanceUrl: string,
): Promise<void> {
  const base = normalizeUrl(instanceUrl);

  // Resolve label name to ID
  const existingLabels = await giteaFetch<{ id: number; name: string }[]>(
    `${base}/api/v1/repos/${repoFullName}/labels?limit=50`,
    token,
  );
  const found = existingLabels.find((l) => l.name === label);
  if (!found) return;

  await fetch(
    `${base}/api/v1/repos/${repoFullName}/issues/${issueNumber}/labels/${found.id}`,
    {
      method: "DELETE",
      headers: giteaHeaders(token),
    },
  );
}

/**
 * Fetch open issues, optionally filtered by since.
 */
export async function fetchOpenIssues(
  repoFullName: string,
  token: string,
  instanceUrl: string,
  since?: string,
): Promise<GiteaIssue[]> {
  const base = normalizeUrl(instanceUrl);
  const params = new URLSearchParams({
    state: "open",
    type: "issues",
    limit: "50",
  });
  if (since) params.set("since", since);

  return giteaFetch<GiteaIssue[]>(
    `${base}/api/v1/repos/${repoFullName}/issues?${params}`,
    token,
  );
}

/**
 * Fetch ALL open issue numbers via pagination.
 */
export async function fetchAllOpenIssueNumbers(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<Set<number>> {
  const base = normalizeUrl(instanceUrl);
  const numbers = new Set<number>();
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      state: "open",
      type: "issues",
      limit: "50",
      page: String(page),
    });

    const issues = await giteaFetch<{ number: number }[]>(
      `${base}/api/v1/repos/${repoFullName}/issues?${params}`,
      token,
    );

    for (const issue of issues) {
      numbers.add(issue.number);
    }

    if (issues.length < 50) break;
    page++;
  }

  return numbers;
}

/**
 * Fetch open issues assigned to a user.
 */
export async function fetchAssignedIssues(
  repoFullName: string,
  token: string,
  assignee: string,
  instanceUrl: string,
  since?: string,
): Promise<GiteaIssue[]> {
  const base = normalizeUrl(instanceUrl);
  const params = new URLSearchParams({
    state: "open",
    type: "issues",
    limit: "50",
  });
  if (since) params.set("since", since);

  const issues = await giteaFetch<GiteaIssue[]>(
    `${base}/api/v1/repos/${repoFullName}/issues?${params}`,
    token,
  );
  // Filter to only issues assigned to the specified user
  return issues.filter((i) =>
    i.assignees?.some((a) => a.login.toLowerCase() === assignee.toLowerCase()),
  );
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
  instanceUrl: string,
): Promise<GiteaPullRequest> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaPullRequest>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}`,
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
  instanceUrl: string,
  opts?: FetchPullRequestsOpts,
): Promise<GiteaPullRequest[]> {
  const base = normalizeUrl(instanceUrl);
  const params = new URLSearchParams();
  if (opts?.state) params.set("state", opts.state);
  params.set("limit", String(opts?.per_page ?? 30));

  return giteaFetch<GiteaPullRequest[]>(
    `${base}/api/v1/repos/${repoFullName}/pulls?${params}`,
    token,
  );
}

// ---------------------------------------------------------------------------
// Pull Request Review APIs
// ---------------------------------------------------------------------------

export interface GiteaReview {
  id: number;
  user: { login: string };
  body: string;
  state: string; // "APPROVED" | "REQUEST_CHANGES" | "COMMENT" | "REJECTED" etc.
  submitted_at: string;
  html_url: string;
}

export interface GiteaReviewComment {
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
  instanceUrl: string,
): Promise<GiteaReview[]> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaReview[]>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}/reviews`,
    token,
  );
}

/**
 * Fetch review comments (inline/diff comments) on a pull request.
 * Gitea returns review comments via the pull comments endpoint.
 */
export async function fetchPullRequestReviewComments(
  repoFullName: string,
  token: string,
  prNumber: number,
  instanceUrl: string,
): Promise<GiteaReviewComment[]> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaReviewComment[]>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}/comments`,
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
  instanceUrl: string,
): Promise<void> {
  const base = normalizeUrl(instanceUrl);
  await giteaFetch<unknown>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}/requested_reviewers`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ reviewers }),
    },
  );
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
  instanceUrl: string,
  body?: string,
): Promise<GiteaPullRequest> {
  const baseUrl = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaPullRequest>(
    `${baseUrl}/api/v1/repos/${repoFullName}/pulls`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ head, base, title, body }),
    },
  );
}

/**
 * Merge a pull request via the Gitea API.
 */
export async function mergePullRequest(
  repoFullName: string,
  token: string,
  prNumber: number,
  instanceUrl: string,
  mergeMethod: "merge" | "squash" | "rebase" = "squash",
  commitTitle?: string,
  commitMessage?: string,
): Promise<void> {
  const base = normalizeUrl(instanceUrl);
  const payload: Record<string, unknown> = {
    Do: mergeMethod,
  };
  if (commitTitle) payload.merge_message_field = commitTitle;
  if (commitMessage) payload.merge_message_field = `${commitTitle ?? ""}\n\n${commitMessage}`;

  await giteaFetch<unknown>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}/merge`,
    token,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Update a pull request (title, body, state).
 */
export async function updatePullRequest(
  repoFullName: string,
  token: string,
  prNumber: number,
  instanceUrl: string,
  updates: { title?: string; body?: string; state?: "open" | "closed" },
): Promise<GiteaPullRequest> {
  const base = normalizeUrl(instanceUrl);
  return giteaFetch<GiteaPullRequest>(
    `${base}/api/v1/repos/${repoFullName}/pulls/${prNumber}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify(updates),
    },
  );
}

// ---------------------------------------------------------------------------
// CI Status APIs (Gitea uses commit statuses)
// ---------------------------------------------------------------------------

export interface GiteaCommitStatus {
  id: number;
  context: string;
  status: "pending" | "success" | "error" | "failure" | "warning";
  target_url: string;
  description: string | null;
  created_at: string;
}

/**
 * Fetch commit statuses for a specific git ref.
 * Gitea uses combined status endpoint.
 */
export async function fetchCommitStatusesForRef(
  repoFullName: string,
  token: string,
  ref: string,
  instanceUrl: string,
): Promise<GiteaCommitStatus[]> {
  const base = normalizeUrl(instanceUrl);
  const data = await giteaFetch<{ statuses: GiteaCommitStatus[] | null }>(
    `${base}/api/v1/repos/${repoFullName}/commits/${encodeURIComponent(ref)}/status`,
    token,
  );
  return data.statuses ?? [];
}

/**
 * Determine the combined CI status for commit statuses.
 */
export function aggregateCommitStatus(
  statuses: GiteaCommitStatus[],
): "pending" | "success" | "failure" | null {
  if (statuses.length === 0) return null;

  const hasPending = statuses.some((s) => s.status === "pending");
  if (hasPending) return "pending";

  const hasFailure = statuses.some(
    (s) => s.status === "failure" || s.status === "error",
  );
  return hasFailure ? "failure" : "success";
}

/**
 * Fetch the diff between two refs.
 * Gitea provides a compare API similar to GitHub's.
 */
export async function fetchCompareCommitsDiff(
  repoFullName: string,
  token: string,
  base: string,
  head: string,
  instanceUrl: string,
): Promise<{ filename: string; status: string; patch?: string }[]> {
  validateRepoName(repoFullName);
  validateBranchName(base);
  validateBranchName(head);

  const baseUrl = normalizeUrl(instanceUrl);
  // Gitea's compare API returns changed files
  const data = await giteaFetch<{
    files?: { filename: string; status: string; contents_url?: string }[];
  }>(
    `${baseUrl}/api/v1/repos/${repoFullName}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    token,
  );
  return (data.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status,
  }));
}

// ---------------------------------------------------------------------------
// Fork-based contribution workflow
// ---------------------------------------------------------------------------

export interface ForkInfo {
  full_name: string;
  clone_url: string;
  ssh_url: string;
  owner: string;
  default_branch: string;
}

/**
 * Create a fork of a repository.
 */
export async function createFork(
  repoFullName: string,
  token: string,
  instanceUrl: string,
): Promise<ForkInfo> {
  const base = normalizeUrl(instanceUrl);
  const res = await fetch(
    `${base}/api/v1/repos/${repoFullName}/forks`,
    {
      method: "POST",
      headers: giteaHeaders(token),
      body: JSON.stringify({}),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gitea API error ${res.status} creating fork: ${body}`);
  }
  const data = (await res.json()) as {
    full_name: string;
    clone_url: string;
    ssh_url: string;
    owner: { login: string };
    default_branch: string;
  };
  return {
    full_name: data.full_name,
    clone_url: data.clone_url,
    ssh_url: data.ssh_url,
    owner: data.owner.login,
    default_branch: data.default_branch,
  };
}

/**
 * Wait for a fork to become available.
 */
export async function waitForFork(
  forkFullName: string,
  token: string,
  instanceUrl: string,
  maxWaitMs = 60_000, // Gitea forks are typically faster than GitHub
): Promise<void> {
  const base = normalizeUrl(instanceUrl);
  const startTime = Date.now();
  let delay = 1_000;

  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(
      `${base}/api/v1/repos/${forkFullName}`,
      { headers: giteaHeaders(token) },
    );
    if (res.ok) return;

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 10_000);
  }

  throw new Error(
    `Fork ${forkFullName} not available after ${Math.round(maxWaitMs / 1000)}s.`,
  );
}

/**
 * Clone a fork as origin and add the upstream repo as a remote.
 */
export function cloneForForkContribution(
  upstreamRepo: string,
  forkRepo: string,
  targetDir: string,
  instanceUrl: string,
  branch?: string,
  projectId?: string,
): void {
  validateRepoName(upstreamRepo);
  validateRepoName(forkRepo);
  if (branch) validateBranchName(branch);

  const token = resolveGiteaToken(projectId);
  if (!token) throw new Error(`Cannot clone fork ${forkRepo}: no Gitea token configured`);

  const base = normalizeUrl(instanceUrl);
  const branchArgs = branch ? ["--branch", branch] : [];
  const forkUrl = `${base}/${forkRepo}.git`;

  execFileSync(
    "git",
    ["clone", ...gitCredentialArgs(), ...branchArgs, forkUrl, targetDir],
    {
      stdio: "pipe",
      timeout: 300_000,
      env: gitEnvWithPAT(token),
    },
  );

  // Add upstream remote
  const upstreamUrl = `${base}/${upstreamRepo}.git`;
  execFileSync("git", ["-C", targetDir, "remote", "add", "upstream", upstreamUrl], {
    stdio: "pipe",
  });

  // Fetch upstream
  execFileSync(
    "git",
    [...gitCredentialArgs(), "-C", targetDir, "fetch", "upstream"],
    {
      stdio: "pipe",
      timeout: 120_000,
      env: gitEnvWithPAT(token),
    },
  );

  configureGitUser(targetDir, projectId);
}

/**
 * Resolve the target branch for a project.
 */
export function resolveProjectBranch(projectId: string): string {
  return getConfig(`project:${projectId}:gitea:branch`)
    ?? getDb().select().from(schema.projects)
        .where(eq(schema.projects.id, projectId)).get()?.giteaBranch
    ?? "main";
}
