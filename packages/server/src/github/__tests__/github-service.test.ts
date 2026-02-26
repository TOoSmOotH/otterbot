import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock auth
const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
}));

// Mock child_process execFileSync
const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

import { cloneRepo, getRepoDefaultBranch, fetchAssignedIssues, fetchCheckRunsForRef, aggregateCheckRunStatus } from "../github-service.js";

describe("github-service", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gh-test-"));
    configStore.clear();
    mockExecFileSync.mockReset();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("cloneRepo", () => {
    it("clones a repo via HTTPS+PAT when token is configured", () => {
      const targetDir = join(tmpDir, "my-repo");
      configStore.set("github:username", "testuser");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir);

      // Should call execFileSync with "git" and args array containing clone
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone"]),
        expect.objectContaining({ timeout: 300_000 }),
      );
      const cloneCall = mockExecFileSync.mock.calls[0];
      const args = cloneCall[1] as string[];
      expect(args).toContain("clone");
      expect(args.some((a: string) => a.includes("https://github.com/owner/repo.git"))).toBe(true);
      expect(args.some((a: string) => a.includes("credential.helper"))).toBe(true);
      expect(args).toContain(targetDir);
    });

    it("clones with a specific branch when provided", () => {
      const targetDir = join(tmpDir, "my-repo-branch");
      configStore.set("github:username", "testuser");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir, "dev");

      const cloneCall = mockExecFileSync.mock.calls[0];
      const args = cloneCall[1] as string[];
      expect(args).toContain("--branch");
      expect(args).toContain("dev");
    });

    it("fetches and checks out when .git already exists", () => {
      const targetDir = join(tmpDir, "existing-repo");
      mkdirSync(targetDir, { recursive: true });
      // Create a fake .git directory
      mkdirSync(join(targetDir, ".git"));

      cloneRepo("owner/repo", targetDir, "main");

      // All calls should be execFileSync("git", [...args], opts)
      const calls = mockExecFileSync.mock.calls;
      const argArrays = calls.map((c: any[]) => c[1] as string[]);
      expect(argArrays.some((a: string[]) => a.includes("fetch") && a.includes("--all"))).toBe(true);
      expect(argArrays.some((a: string[]) => a.includes("checkout") && a.includes("main"))).toBe(true);
      expect(argArrays.some((a: string[]) => a.includes("pull") && a.includes("main"))).toBe(true);
      // Should NOT have called git clone
      expect(argArrays.some((a: string[]) => a.includes("clone"))).toBe(false);
    });

    it("configures git user after clone", () => {
      const targetDir = join(tmpDir, "user-config-repo");
      configStore.set("github:username", "myuser");
      configStore.set("github:email", "myuser@example.com");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir);

      const argArrays = mockExecFileSync.mock.calls.map((c: any[]) => c[1] as string[]);
      expect(argArrays.some((a: string[]) => a.includes("user.name") && a.includes("myuser"))).toBe(true);
      expect(argArrays.some((a: string[]) => a.includes("user.email") && a.includes("myuser@example.com"))).toBe(true);
    });

    it("uses default email when github:email is not set", () => {
      const targetDir = join(tmpDir, "default-email-repo");
      configStore.set("github:username", "myuser");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir);

      const argArrays = mockExecFileSync.mock.calls.map((c: any[]) => c[1] as string[]);
      expect(argArrays.some((a: string[]) => a.includes("myuser@users.noreply.github.com"))).toBe(true);
    });

    it("throws descriptive error when no PAT or SSH key configured", () => {
      const targetDir = join(tmpDir, "no-auth-repo");
      expect(() => cloneRepo("owner/repo", targetDir)).toThrow(
        /no GitHub PAT configured and no SSH key found/,
      );
    });
  });

  describe("getRepoDefaultBranch", () => {
    it("returns the default branch from the GitHub API", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ default_branch: "develop" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const branch = await getRepoDefaultBranch("owner/repo", "ghp_test123");

      expect(branch).toBe("develop");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test123",
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("throws on API error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(getRepoDefaultBranch("owner/missing", "ghp_test")).rejects.toThrow(
        "GitHub API error 404",
      );

      vi.unstubAllGlobals();
    });
  });

  describe("fetchAssignedIssues", () => {
    it("returns issues assigned to the user", async () => {
      const mockIssues = [
        {
          number: 42,
          title: "Fix bug",
          body: "Description",
          labels: [{ name: "bug" }],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/42",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-02T00:00:00Z",
        },
      ];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIssues),
      });
      vi.stubGlobal("fetch", mockFetch);

      const issues = await fetchAssignedIssues("owner/repo", "ghp_test", "testuser");

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(42);
      expect(issues[0].title).toBe("Fix bug");

      // Verify the query parameters
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("assignee=testuser");
      expect(url).toContain("state=open");

      vi.unstubAllGlobals();
    });

    it("filters out pull requests", async () => {
      const mockIssues = [
        {
          number: 1,
          title: "Real issue",
          body: null,
          labels: [],
          assignees: [{ login: "testuser" }],
          state: "open",
          html_url: "https://github.com/owner/repo/issues/1",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          number: 2,
          title: "A PR",
          body: null,
          labels: [],
          assignees: [],
          state: "open",
          html_url: "https://github.com/owner/repo/pull/2",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/2" },
        },
      ];
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIssues),
      });
      vi.stubGlobal("fetch", mockFetch);

      const issues = await fetchAssignedIssues("owner/repo", "ghp_test", "testuser");

      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(1);

      vi.unstubAllGlobals();
    });

    it("passes since parameter when provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });
      vi.stubGlobal("fetch", mockFetch);

      await fetchAssignedIssues("owner/repo", "ghp_test", "testuser", "2026-01-01T00:00:00Z");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("since=2026-01-01T00%3A00%3A00Z");

      vi.unstubAllGlobals();
    });

    it("throws on API error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        fetchAssignedIssues("owner/repo", "bad_token", "testuser"),
      ).rejects.toThrow("GitHub API error 401");

      vi.unstubAllGlobals();
    });
  });

  describe("fetchCheckRunsForRef", () => {
    it("fetches check runs for a given ref", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            total_count: 2,
            check_runs: [
              {
                id: 123,
                name: "Test Suite",
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/owner/repo/runs/123",
                started_at: "2026-02-20T00:00:00Z",
                completed_at: "2026-02-20T00:05:00Z",
              },
              {
                id: 456,
                name: "Lint",
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/owner/repo/runs/456",
                started_at: "2026-02-20T00:00:00Z",
                completed_at: "2026-02-20T00:02:00Z",
              },
            ],
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const checkRuns = await fetchCheckRunsForRef("owner/repo", "ghp_test", "main");

      expect(checkRuns).toHaveLength(2);
      expect(checkRuns[0].id).toBe(123);
      expect(checkRuns[0].name).toBe("Test Suite");
      expect(checkRuns[0].status).toBe("completed");
      expect(checkRuns[0].conclusion).toBe("success");

      const call = mockFetch.mock.calls[0];
      const url = call[0] as string;
      expect(url).toBe(
        "https://api.github.com/repos/owner/repo/commits/main/check-runs?per_page=100",
      );
      expect(call[1]).toEqual({
        headers: {
          Authorization: "Bearer ghp_test",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      vi.unstubAllGlobals();
    });

    it("URL-encodes the ref parameter", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ total_count: 0, check_runs: [] }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const checkRuns = await fetchCheckRunsForRef("owner/repo", "ghp_test", "feat/branch-name");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("commits/feat%2Fbranch-name/check-runs");

      vi.unstubAllGlobals();
    });

    it("throws on API error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });
      vi.stubGlobal("fetch", mockFetch);

      await expect(fetchCheckRunsForRef("owner/missing", "ghp_test", "main")).rejects.toThrow("GitHub API error 404");

      vi.unstubAllGlobals();
    });
  });

  describe("aggregateCheckRunStatus", () => {
    it("returns null for empty check runs", () => {
      expect(aggregateCheckRunStatus([])).toBeNull();
    });

    it("returns pending when checks are queued", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "queued" as const,
          conclusion: null,
          html_url: "",
          started_at: null,
          completed_at: null,
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("pending");
    });

    it("returns pending when checks are in progress", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "in_progress" as const,
          conclusion: null,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: null,
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("pending");
    });

    it("returns pending when mix of complete and incomplete", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "success",
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 2,
          name: "Lint",
          status: "in_progress" as const,
          conclusion: null,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: null,
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("pending");
    });

    it("returns success when all checks complete successfully", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 2,
          name: "Lint",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:02:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("success");
    });

    it("returns success when checks are skipped", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "skipped" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("success");
    });

    it("returns success when checks are neutral", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "neutral" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("success");
    });

    it("returns failure when a check fails", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 2,
          name: "Build",
          status: "completed" as const,
          conclusion: "failure" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:08:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("failure");
    });

    it("returns failure when check times out", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "timed_out" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:10:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("failure");
    });

    it("returns failure when check is cancelled", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "cancelled" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("failure");
    });

    it("returns failure when check requires action", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "action_required" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("failure");
    });

    it("returns failure if any check fails among many", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test1",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 2,
          name: "Test2",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 3,
          name: "Test3",
          status: "completed" as const,
          conclusion: "failure" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:08:00Z",
        },
        {
          id: 4,
          name: "Test4",
          status: "completed" as const,
          conclusion: "skipped" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:01:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("failure");
    });

    it("returns success when all checks complete without failures", () => {
      const checkRuns = [
        {
          id: 1,
          name: "Test",
          status: "completed" as const,
          conclusion: "success" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:05:00Z",
        },
        {
          id: 2,
          name: "Lint",
          status: "completed" as const,
          conclusion: "skipped" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:01:00Z",
        },
        {
          id: 3,
          name: "Deploy",
          status: "completed" as const,
          conclusion: "neutral" as const,
          html_url: "",
          started_at: "2026-02-20T00:00:00Z",
          completed_at: "2026-02-20T00:02:00Z",
        },
      ];
      expect(aggregateCheckRunStatus(checkRuns)).toBe("success");
    });
  });
});
