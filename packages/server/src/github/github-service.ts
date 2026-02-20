import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { getConfig } from "../auth/auth.js";

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

/**
 * Clone a GitHub repo via SSH into targetDir, optionally checking out a branch.
 * Relies on SSH key already configured by `configureGitSSH()` in settings.ts.
 */
export function cloneRepo(
  repoFullName: string,
  targetDir: string,
  branch?: string,
): void {
  const url = `git@github.com:${repoFullName}.git`;

  if (existsSync(targetDir + "/.git")) {
    // Already cloned — fetch and checkout
    execSync(`git -C ${targetDir} fetch --all`, { stdio: "pipe", timeout: 120_000 });
    if (branch) {
      execSync(`git -C ${targetDir} checkout ${branch}`, { stdio: "pipe", timeout: 30_000 });
      execSync(`git -C ${targetDir} pull origin ${branch}`, { stdio: "pipe", timeout: 120_000 });
    }
    return;
  }

  const branchArg = branch ? `--branch ${branch}` : "";
  execSync(`git clone ${branchArg} ${url} ${targetDir}`, {
    stdio: "pipe",
    timeout: 300_000, // 5 min for large repos
    env: { ...process.env },
  });

  // Configure git user from settings
  const userName = getConfig("github:username") ?? "otterbot";
  const userEmail = getConfig("github:email") ?? `${userName}@users.noreply.github.com`;
  execSync(`git -C ${targetDir} config user.name "${userName}"`, { stdio: "pipe" });
  execSync(`git -C ${targetDir} config user.email "${userEmail}"`, { stdio: "pipe" });
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
  return issues.filter((i) => !(i as any).pull_request);
}
