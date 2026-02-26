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

import {
  cloneRepo,
  getRepoDefaultBranch,
  fetchAssignedIssues,
  checkIsCollaborator,
} from "../github-service.js";

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

  describe("checkIsCollaborator", () => {
    beforeEach(() => {
      configStore.clear();
    });

    it("returns true when the user is a collaborator (204 response)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 204,
        ok: true,
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", mockFetch);

      const isCollab = await checkIsCollaborator("owner/repo", "ghp_test", "testuser");

      expect(isCollab).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo/collaborators/testuser",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test",
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("returns false when the user is not a collaborator (404 response)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        text: () => Promise.resolve("Not Found"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const isCollab = await checkIsCollaborator("owner/repo", "ghp_test", "noncollab");

      expect(isCollab).toBe(false);

      vi.unstubAllGlobals();
    });

    it("handles non-204/404 responses as not a collaborator", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const isCollab = await checkIsCollaborator("owner/repo", "bad_token", "testuser");

      expect(isCollab).toBe(false);

      vi.unstubAllGlobals();
    });

    it("handles special characters in username", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 204,
        ok: true,
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", mockFetch);

      await checkIsCollaborator("owner/repo", "ghp_test", "user-name");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("user-name");

      vi.unstubAllGlobals();
    });
  });
});
