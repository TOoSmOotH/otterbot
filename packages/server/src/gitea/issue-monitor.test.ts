import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../db/index.js";

const configStore = new Map<string, string>();
vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
}));

const mockResolveGiteaToken = vi.fn((_projectId?: string) => configStore.get("gitea:token"));
const mockResolveGiteaUsername = vi.fn((_projectId?: string) => configStore.get("gitea:username"));
const mockResolveGiteaInstanceUrl = vi.fn((_projectId?: string) => configStore.get("gitea:instance_url"));
vi.mock("./account-resolver.js", () => ({
  resolveGiteaToken: (...args: string[]) => mockResolveGiteaToken(...args),
  resolveGiteaUsername: (...args: string[]) => mockResolveGiteaUsername(...args),
  resolveGiteaInstanceUrl: (...args: string[]) => mockResolveGiteaInstanceUrl(...args),
}));

const mockFetchAssignedIssues = vi.fn().mockResolvedValue([]);
const mockCheckHasTriageAccess = vi.fn().mockResolvedValue(true);
vi.mock("./gitea-service.js", () => ({
  fetchAssignedIssues: (...args: unknown[]) => mockFetchAssignedIssues(...args),
  fetchOpenIssues: vi.fn().mockResolvedValue([]),
  fetchAllOpenIssueNumbers: vi.fn().mockResolvedValue(new Set<number>()),
  fetchIssue: vi.fn(),
  fetchIssueComments: vi.fn().mockResolvedValue([]),
  createIssueComment: vi.fn().mockResolvedValue({}),
  removeLabelFromIssue: vi.fn().mockResolvedValue(undefined),
  checkHasTriageAccess: (...args: unknown[]) => mockCheckHasTriageAccess(...args),
}));

import { GiteaIssueMonitor } from "./issue-monitor.js";

function createMockCoo() {
  return {
    getTeamLeads: vi.fn(() => new Map()),
    bus: { send: vi.fn() },
  };
}

function createMockIo() {
  return { emit: vi.fn() };
}

describe("GiteaIssueMonitor", () => {
  let tmpDir: string;
  let monitor: GiteaIssueMonitor;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gitea-issue-monitor-test-"));
    resetDb();
    configStore.clear();
    mockFetchAssignedIssues.mockReset().mockResolvedValue([]);
    mockCheckHasTriageAccess.mockReset().mockResolvedValue(true);
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();

    monitor = new GiteaIssueMonitor(createMockCoo() as any, createMockIo() as any);
  });

  afterEach(() => {
    monitor.stop();
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("watches and unwatches projects for assigned-issue polling", async () => {
    configStore.set("gitea:token", "pat");
    configStore.set("gitea:instance_url", "https://git.example.com");

    monitor.watchProject("proj-1", "owner/repo", "bot");
    await (monitor as any).poll();

    expect(mockFetchAssignedIssues).toHaveBeenCalledWith(
      "owner/repo",
      "pat",
      "bot",
      "https://git.example.com",
      undefined,
    );

    mockFetchAssignedIssues.mockClear();
    monitor.unwatchProject("proj-1");
    await (monitor as any).poll();

    expect(mockFetchAssignedIssues).not.toHaveBeenCalled();
  });

  it("loads only active projects with gitea issue monitor enabled and available username", async () => {
    const db = getDb();

    db.insert(schema.projects)
      .values({
        id: "proj-enabled",
        name: "Enabled",
        description: "",
        status: "active",
        giteaRepo: "owner/enabled",
        giteaIssueMonitor: true,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    db.insert(schema.projects)
      .values({
        id: "proj-disabled",
        name: "Disabled",
        description: "",
        status: "active",
        giteaRepo: "owner/disabled",
        giteaIssueMonitor: false,
        rules: [],
        createdAt: new Date().toISOString(),
      })
      .run();

    configStore.set("gitea:token", "pat");
    configStore.set("gitea:instance_url", "https://git.example.com");
    configStore.set("gitea:username", "gitea-bot");

    monitor.loadFromDb();
    await (monitor as any).poll();

    expect(mockFetchAssignedIssues).toHaveBeenCalledTimes(1);
    expect(mockFetchAssignedIssues).toHaveBeenCalledWith(
      "owner/enabled",
      "pat",
      "gitea-bot",
      "https://git.example.com",
      undefined,
    );
  });

  describe("polling lifecycle", () => {
    it("defers polling when start() is called without watched projects", () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      monitor.start(1_000);

      expect(setIntervalSpy).not.toHaveBeenCalled();

      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it("auto-starts polling when a project is watched after deferred start()", () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      monitor.start(1_234);
      monitor.watchProject("proj-auto-start", "owner/repo", "bot");

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_234);

      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it("pauses polling when the final watched project is removed", () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      monitor.watchProject("proj-stop", "owner/repo", "bot");
      monitor.start(1_000);
      monitor.unwatchProject("proj-stop");

      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
