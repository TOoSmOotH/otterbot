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

// Mock child_process execSync
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

import { cloneRepo, getRepoDefaultBranch, fetchAssignedIssues } from "../github-service.js";

describe("github-service", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gh-test-"));
    configStore.clear();
    mockExecSync.mockReset();
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

      // Should call git clone with HTTPS URL
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("git clone"),
        expect.objectContaining({ timeout: 300_000 }),
      );
      const cloneCall = mockExecSync.mock.calls[0];
      expect(cloneCall[0]).toContain("https://github.com/owner/repo.git");
      expect(cloneCall[0]).toContain("credential.helper");
      expect(cloneCall[0]).toContain(targetDir);
    });

    it("clones with a specific branch when provided", () => {
      const targetDir = join(tmpDir, "my-repo-branch");
      configStore.set("github:username", "testuser");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir, "dev");

      const cloneCall = mockExecSync.mock.calls[0];
      expect(cloneCall[0]).toContain("--branch dev");
    });

    it("fetches and checks out when .git already exists", () => {
      const targetDir = join(tmpDir, "existing-repo");
      mkdirSync(targetDir, { recursive: true });
      // Create a fake .git directory
      mkdirSync(join(targetDir, ".git"));

      cloneRepo("owner/repo", targetDir, "main");

      // Should call fetch, not clone
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("git -C"),
        expect.any(Object),
      );
      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: string) => c.includes("fetch --all"))).toBe(true);
      expect(calls.some((c: string) => c.includes("checkout main"))).toBe(true);
      expect(calls.some((c: string) => c.includes("pull origin main"))).toBe(true);
      // Should NOT have called git clone
      expect(calls.some((c: string) => c.includes("git clone"))).toBe(false);
    });

    it("configures git user after clone", () => {
      const targetDir = join(tmpDir, "user-config-repo");
      configStore.set("github:username", "myuser");
      configStore.set("github:email", "myuser@example.com");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir);

      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: string) => c.includes('config user.name "myuser"'))).toBe(true);
      expect(calls.some((c: string) => c.includes('config user.email "myuser@example.com"'))).toBe(true);
    });

    it("uses default email when github:email is not set", () => {
      const targetDir = join(tmpDir, "default-email-repo");
      configStore.set("github:username", "myuser");
      configStore.set("github:token", "ghp_test123");

      cloneRepo("owner/repo", targetDir);

      const calls = mockExecSync.mock.calls.map((c: any[]) => c[0]);
      expect(calls.some((c: string) => c.includes("myuser@users.noreply.github.com"))).toBe(true);
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
});
