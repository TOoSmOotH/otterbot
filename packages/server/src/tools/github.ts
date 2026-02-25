import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "../auth/auth.js";
import {
  fetchIssue,
  fetchIssues,
  fetchIssueComments,
  createIssueComment,
  fetchPullRequest,
  fetchPullRequests,
  createPullRequest,
} from "../github/github-service.js";
import type { ToolContext } from "./tool-context.js";

function getGitHubContext(ctx: ToolContext): { repo: string; token: string; username: string } {
  const token = getConfig("github:token");
  if (!token) throw new Error("GitHub token not configured. Set github:token in Settings.");

  const username = getConfig("github:username");
  if (!username) throw new Error("GitHub username not configured. Set github:username in Settings.");

  const repo = getConfig(`project:${ctx.projectId}:github:repo`);
  if (!repo) throw new Error("GitHub repo not configured for this project. Set it in project settings.");

  return { repo, token, username };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export function createGitHubGetIssueTool(ctx: ToolContext) {
  return tool({
    description:
      "Fetch a GitHub issue by number, including its comments. Returns the issue title, body, labels, assignees, and all comments.",
    parameters: z.object({
      issue_number: z.number().int().describe("The issue number to fetch"),
    }),
    execute: async ({ issue_number }) => {
      try {
        const { repo, token } = getGitHubContext(ctx);
        const [issue, comments] = await Promise.all([
          fetchIssue(repo, token, issue_number),
          fetchIssueComments(repo, token, issue_number),
        ]);

        let result = `# Issue #${issue.number}: ${issue.title}\n`;
        result += `State: ${issue.state}\n`;
        result += `URL: ${issue.html_url}\n`;
        result += `Labels: ${issue.labels.map((l) => l.name).join(", ") || "none"}\n`;
        result += `Assignees: ${issue.assignees.map((a) => a.login).join(", ") || "unassigned"}\n`;
        result += `Created: ${issue.created_at}\n`;
        result += `Updated: ${issue.updated_at}\n`;
        result += `\n## Body\n${issue.body ?? "(no description)"}\n`;

        if (comments.length > 0) {
          result += `\n## Comments (${comments.length})\n`;
          for (const c of comments) {
            result += `\n### @${c.user.login} (${c.created_at})\n${c.body}\n`;
          }
        }

        return result;
      } catch (err) {
        return `Error fetching issue: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

export function createGitHubListIssuesTool(ctx: ToolContext) {
  return tool({
    description:
      "List GitHub issues for the project repository. By default only shows issues assigned to you. Returns issue number, title, state, labels, and assignees.",
    parameters: z.object({
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Filter by state (default: open)"),
      labels: z
        .string()
        .optional()
        .describe("Comma-separated label names to filter by"),
      assignee: z
        .string()
        .optional()
        .describe("Filter by assignee login. Defaults to your configured GitHub username."),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (default: 30, max: 100)"),
    }),
    execute: async ({ state, labels, assignee, per_page }) => {
      try {
        const { repo, token, username } = getGitHubContext(ctx);
        const issues = await fetchIssues(repo, token, {
          state: state ?? "open",
          labels,
          assignee: assignee ?? username,
          per_page,
        });

        if (issues.length === 0) {
          return "No issues found matching the filters.";
        }

        const lines = issues.map((i) => {
          const lbls = i.labels.map((l) => l.name).join(", ");
          const assigned = i.assignees.map((a) => a.login).join(", ");
          return `- #${i.number} [${i.state}] ${i.title}${lbls ? ` (${lbls})` : ""}${assigned ? ` → ${assigned}` : ""}`;
        });

        return `Found ${issues.length} issue(s):\n${lines.join("\n")}`;
      } catch (err) {
        return `Error listing issues: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export function createGitHubGetPRTool(ctx: ToolContext) {
  return tool({
    description:
      "Fetch a GitHub pull request by number, including its comments. Returns PR title, body, state, branches, and all comments.",
    parameters: z.object({
      pr_number: z.number().int().describe("The pull request number to fetch"),
    }),
    execute: async ({ pr_number }) => {
      try {
        const { repo, token } = getGitHubContext(ctx);
        const [pr, comments] = await Promise.all([
          fetchPullRequest(repo, token, pr_number),
          fetchIssueComments(repo, token, pr_number),
        ]);

        let result = `# PR #${pr.number}: ${pr.title}\n`;
        result += `State: ${pr.state}${pr.merged ? " (merged)" : ""}\n`;
        result += `URL: ${pr.html_url}\n`;
        result += `Branches: ${pr.head.ref} → ${pr.base.ref}\n`;
        result += `Author: @${pr.user.login}\n`;
        result += `Labels: ${pr.labels.map((l) => l.name).join(", ") || "none"}\n`;
        result += `Assignees: ${pr.assignees.map((a) => a.login).join(", ") || "unassigned"}\n`;
        result += `Created: ${pr.created_at}\n`;
        result += `Updated: ${pr.updated_at}\n`;
        if (pr.mergeable !== null) {
          result += `Mergeable: ${pr.mergeable}\n`;
        }
        result += `\n## Body\n${pr.body ?? "(no description)"}\n`;

        if (comments.length > 0) {
          result += `\n## Comments (${comments.length})\n`;
          for (const c of comments) {
            result += `\n### @${c.user.login} (${c.created_at})\n${c.body}\n`;
          }
        }

        return result;
      } catch (err) {
        return `Error fetching PR: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

export function createGitHubListPRsTool(ctx: ToolContext) {
  return tool({
    description:
      "List GitHub pull requests for the project repository. Returns PR number, title, state, and head/base branches.",
    parameters: z.object({
      state: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Filter by state (default: open)"),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of results per page (default: 30, max: 100)"),
    }),
    execute: async ({ state, per_page }) => {
      try {
        const { repo, token } = getGitHubContext(ctx);
        const prs = await fetchPullRequests(repo, token, {
          state: state ?? "open",
          per_page,
        });

        if (prs.length === 0) {
          return "No pull requests found matching the filters.";
        }

        const lines = prs.map((pr) => {
          const merged = pr.merged ? " [merged]" : "";
          return `- #${pr.number} [${pr.state}${merged}] ${pr.title} (${pr.head.ref} → ${pr.base.ref}) by @${pr.user.login}`;
        });

        return `Found ${prs.length} PR(s):\n${lines.join("\n")}`;
      } catch (err) {
        return `Error listing PRs: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Comments & PR creation
// ---------------------------------------------------------------------------

export function createGitHubCommentTool(ctx: ToolContext) {
  return tool({
    description:
      "Post a comment on a GitHub issue or pull request.",
    parameters: z.object({
      issue_number: z
        .number()
        .int()
        .describe("The issue or PR number to comment on"),
      body: z.string().describe("The comment text (Markdown supported)"),
    }),
    execute: async ({ issue_number, body }) => {
      try {
        const { repo, token } = getGitHubContext(ctx);
        const comment = await createIssueComment(repo, token, issue_number, body);
        return `Comment posted: ${comment.html_url}`;
      } catch (err) {
        return `Error posting comment: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}

export function createGitHubCreatePRTool(ctx: ToolContext) {
  return tool({
    description:
      "Create a new GitHub pull request. Returns the PR URL and number.",
    parameters: z.object({
      title: z.string().describe("PR title"),
      head: z.string().describe("The branch containing your changes"),
      base: z
        .string()
        .optional()
        .describe("The branch to merge into (defaults to the project's configured branch)"),
      body: z
        .string()
        .optional()
        .describe("PR description (Markdown supported)"),
    }),
    execute: async ({ title, head, base, body }) => {
      try {
        const { repo, token } = getGitHubContext(ctx);
        const targetBase = base ?? getConfig(`project:${ctx.projectId}:github:branch`) ?? "main";
        const pr = await createPullRequest(repo, token, head, targetBase, title, body);
        return `Pull request created: #${pr.number} — ${pr.html_url}`;
      } catch (err) {
        return `Error creating PR: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
