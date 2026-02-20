import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
 */
function gitCredentialArgs(): string {
  return `-c credential.helper="!f() { echo username=x-access-token; echo password=$GIT_PAT; }; f"`;
}

/**
 * Configure git user identity in a cloned repo.
 */
function configureGitUser(targetDir: string): void {
  const userName = getConfig("github:username") ?? "otterbot";
  const userEmail =
    getConfig("github:email") ?? `${userName}@users.noreply.github.com`;
  execSync(`git -C ${targetDir} config user.name "${userName}"`, {
    stdio: "pipe",
  });
  execSync(`git -C ${targetDir} config user.email "${userEmail}"`, {
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
    execSync(
      token
        ? `git ${gitCredentialArgs()} -C ${targetDir} fetch --all`
        : `git -C ${targetDir} fetch --all`,
      fetchOpts,
    );
    if (branch) {
      execSync(`git -C ${targetDir} checkout ${branch}`, {
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
      execSync(
        token
          ? `git ${gitCredentialArgs()} -C ${targetDir} pull origin ${branch}`
          : `git -C ${targetDir} pull origin ${branch}`,
        pullOpts,
      );
    }
    return;
  }

  const branchArg = branch ? `--branch ${branch}` : "";
  let httpsErr: unknown;

  // Try HTTPS+PAT first
  if (token) {
    const httpsUrl = `https://github.com/${repoFullName}.git`;
    try {
      execSync(
        `git clone ${gitCredentialArgs()} ${branchArg} ${httpsUrl} ${targetDir}`,
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
    execSync(`git clone ${branchArg} ${sshUrl} ${targetDir}`, {
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
  return issues.filter((i) => !(i as any).pull_request);
}
