import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentRole } from "@otterbot/shared";

const configStore = new Map<string, string>();

const mockCreatePullRequest = vi.fn();

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
}));

vi.mock("../../github/account-resolver.js", () => ({
  resolveGitHubAccount: vi.fn((projectId?: string) => {
    const token = configStore.get("github:token");
    const username = configStore.get("github:username");
    if (!token) return null;
    return { token, username, email: null, sshKeyPath: null, sshKeyUsage: "both" };
  }),
}));

vi.mock("../../github/github-service.js", () => ({
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(),
  fetchIssueComments: vi.fn(),
  createIssueComment: vi.fn(),
  fetchPullRequest: vi.fn(),
  fetchPullRequests: vi.fn(),
  createPullRequest: (...args: unknown[]) => mockCreatePullRequest(...args),
  resolveProjectBranch: vi.fn(() => "main"),
}));

import { createGitHubCreatePRTool } from "../github.js";

describe("createGitHubCreatePRTool", () => {
  const ctx = {
    workspacePath: "/tmp/workspace",
    projectId: "proj-1",
    agentId: "agent-1",
    role: AgentRole.Worker,
  };

  beforeEach(() => {
    configStore.clear();
    mockCreatePullRequest.mockReset();
    mockCreatePullRequest.mockResolvedValue({
      number: 42,
      html_url: "https://github.com/upstream/repo/pull/42",
    });
    configStore.set("github:token", "token-1");
    configStore.set("github:username", "botuser");
    configStore.set("project:proj-1:github:repo", "upstream/repo");
  });

  it("uses fork-owner head ref in fork mode", async () => {
    configStore.set("project:proj-1:github:fork_mode", "true");
    configStore.set("project:proj-1:github:fork_repo", "botuser/repo");

    const tool = createGitHubCreatePRTool(ctx);
    const result = await (tool as any).execute({
      title: "feat: add support",
      head: "feat/new-feature",
      body: "body",
    });

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      "upstream/repo",
      "token-1",
      "botuser:feat/new-feature",
      "main",
      "feat: add support",
      "body",
    );
    expect(result).toContain("Pull request created: #42");
  });

  it("does not rewrite head when it already has owner prefix", async () => {
    configStore.set("project:proj-1:github:fork_mode", "true");
    configStore.set("project:proj-1:github:fork_repo", "botuser/repo");

    const tool = createGitHubCreatePRTool(ctx);
    await (tool as any).execute({
      title: "feat: add support",
      head: "botuser:feat/new-feature",
      body: "body",
    });

    expect(mockCreatePullRequest).toHaveBeenCalledWith(
      "upstream/repo",
      "token-1",
      "botuser:feat/new-feature",
      "main",
      "feat: add support",
      "body",
    );
  });

  it("returns informative message and skips PR creation when upstream PR is disabled", async () => {
    configStore.set("project:proj-1:github:fork_mode", "true");
    configStore.set("project:proj-1:github:fork_repo", "botuser/repo");
    configStore.set("project:proj-1:github:fork_upstream_pr", "false");

    const tool = createGitHubCreatePRTool(ctx);
    const result = await (tool as any).execute({
      title: "feat: add support",
      head: "feat/new-feature",
      body: "body",
    });

    expect(result).toContain("Upstream PR creation is disabled");
    expect(mockCreatePullRequest).not.toHaveBeenCalled();
  });
});
