import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../db/index.js";
import { eq } from "drizzle-orm";

const configStore = new Map<string, string>();
vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
}));

vi.mock("./account-resolver.js", () => ({
  resolveGiteaAccount: vi.fn(() => {
    const token = configStore.get("gitea:token");
    const instanceUrl = configStore.get("gitea:instance_url");
    if (!token || !instanceUrl) return null;
    return {
      id: "__legacy__",
      label: "Legacy",
      token,
      username: configStore.get("gitea:username") ?? null,
      email: configStore.get("gitea:email") ?? null,
      instanceUrl,
      isDefault: true,
    };
  }),
  resolveGiteaToken: vi.fn(() => configStore.get("gitea:token")),
  resolveGiteaInstanceUrl: vi.fn(() => configStore.get("gitea:instance_url")),
}));

const mockExistsSync = vi.fn<(p: string) => boolean>();
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (p: string) =>
      mockExistsSync.getMockImplementation() ? mockExistsSync(p) : actual.existsSync(p),
  };
});

const mockExecFileSync = vi.fn();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

import {
  gitEnvWithPAT,
  gitCredentialArgs,
  cloneRepo,
  getRepoDefaultBranch,
  fetchIssues,
  fetchAssignedIssues,
  aggregateCommitStatus,
  resolveProjectBranch,
} from "./gitea-service.js";

describe("gitea-service", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gitea-service-test-"));
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    resetDb();
    await migrateDb();
    configStore.clear();
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("builds git env and credential args for PAT auth", () => {
    const env = gitEnvWithPAT("pat-123");
    const args = gitCredentialArgs();

    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_PAT).toBe("pat-123");
    expect(args).toEqual([
      "-c",
      "credential.helper=!f() { echo username=x-access-token; echo password=$GIT_PAT; }; f",
    ]);
  });

  it("clones via HTTPS using configured Gitea instance URL", () => {
    const targetDir = join(tmpDir, "repo");
    configStore.set("gitea:token", "pat");
    configStore.set("gitea:instance_url", "https://git.example.com/");
    configStore.set("gitea:username", "bot");
    configStore.set("gitea:email", "bot@example.com");

    cloneRepo("owner/repo", targetDir, "main");

    const cloneCall = mockExecFileSync.mock.calls[0];
    const cloneArgs = cloneCall[1] as string[];

    expect(cloneArgs).toContain("clone");
    expect(cloneArgs).toContain("--branch");
    expect(cloneArgs).toContain("main");
    expect(cloneArgs).toContain("https://git.example.com/owner/repo.git");

    const allArgArrays = mockExecFileSync.mock.calls.map((c: any[]) => c[1] as string[]);
    expect(allArgArrays.some((a: string[]) => a.includes("user.name") && a.includes("bot"))).toBe(true);
    expect(allArgArrays.some((a: string[]) => a.includes("user.email") && a.includes("bot@example.com"))).toBe(true);
  });

  it("fetches and pulls when repository already exists", () => {
    const targetDir = join(tmpDir, "existing");
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(join(targetDir, ".git"));
    configStore.set("gitea:token", "pat");
    configStore.set("gitea:instance_url", "https://git.example.com");

    cloneRepo("owner/repo", targetDir, "main");

    const argArrays = mockExecFileSync.mock.calls.map((c: any[]) => c[1] as string[]);
    expect(argArrays.some((a: string[]) => a.includes("fetch") && a.includes("--all"))).toBe(true);
    expect(argArrays.some((a: string[]) => a.includes("checkout") && a.includes("main"))).toBe(true);
    expect(argArrays.some((a: string[]) => a.includes("pull") && a.includes("main"))).toBe(true);
    expect(argArrays.some((a: string[]) => a.includes("clone"))).toBe(false);
  });

  it("throws when token or instance URL is missing", () => {
    const targetDir = join(tmpDir, "missing-auth");
    expect(() => cloneRepo("owner/repo", targetDir)).toThrow(
      /no Gitea token or instance URL configured/,
    );
  });

  it("returns default branch from Gitea API", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ default_branch: "develop" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const branch = await getRepoDefaultBranch("owner/repo", "pat", "https://git.example.com");

    expect(branch).toBe("develop");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://git.example.com/api/v1/repos/owner/repo",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "token pat" }),
      }),
    );
  });

  it("passes filters through fetchIssues query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal("fetch", mockFetch);

    await fetchIssues("owner/repo", "pat", "https://git.example.com", {
      state: "open",
      labels: "bug,urgent",
      assignee: "octo",
      per_page: 15,
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("type=issues");
    expect(url).toContain("state=open");
    expect(url).toContain("labels=bug%2Curgent");
    expect(url).toContain("assignee=octo");
    expect(url).toContain("limit=15");
  });

  it("filters assigned issues case-insensitively", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        {
          number: 1,
          title: "Mine",
          body: null,
          labels: [],
          assignees: [{ login: "TestUser" }],
          state: "open",
          html_url: "",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          number: 2,
          title: "Not mine",
          body: null,
          labels: [],
          assignees: [{ login: "other" }],
          state: "open",
          html_url: "",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const issues = await fetchAssignedIssues(
      "owner/repo",
      "pat",
      "testuser",
      "https://git.example.com",
    );

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("aggregates commit status correctly", () => {
    expect(aggregateCommitStatus([])).toBeNull();
    expect(
      aggregateCommitStatus([
        { id: 1, context: "ci", status: "pending", target_url: "", description: null, created_at: "" },
      ]),
    ).toBe("pending");
    expect(
      aggregateCommitStatus([
        { id: 1, context: "ci", status: "success", target_url: "", description: null, created_at: "" },
      ]),
    ).toBe("success");
    expect(
      aggregateCommitStatus([
        { id: 1, context: "ci", status: "error", target_url: "", description: null, created_at: "" },
      ]),
    ).toBe("failure");
  });

  it("uses project branch config fallback and defaults to main", () => {
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "proj-1",
        name: "Gitea Project",
        description: "",
        status: "active",
        giteaBranch: "develop",
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    configStore.set("project:proj-1:gitea:branch", "release");
    expect(resolveProjectBranch("proj-1")).toBe("release");
    configStore.delete("project:proj-1:gitea:branch");
    expect(resolveProjectBranch("proj-1")).toBe("develop");
    expect(resolveProjectBranch("proj-2")).toBe("main");

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, "proj-1")).get();
    expect(project?.giteaBranch).toBe("develop");
  });
});
