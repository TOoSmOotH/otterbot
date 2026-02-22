import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

// --- Mocks ---

const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

vi.mock("../../desktop/desktop.js", () => ({
  isDesktopEnabled: vi.fn(() => false),
  getDesktopConfig: vi.fn(() => ({})),
}));

vi.mock("../../models3d/model-packs.js", () => ({
  getRandomModelPackId: vi.fn(() => "pack-1"),
}));

vi.mock("../../llm/adapter.js", () => ({
  stream: vi.fn(),
  resolveProviderCredentials: vi.fn(() => ({ type: "anthropic" })),
}));

vi.mock("../../llm/circuit-breaker.js", () => ({
  isProviderAvailable: vi.fn(() => true),
  getCircuitBreaker: vi.fn(() => ({ recordSuccess: vi.fn(), recordFailure: vi.fn(), remainingCooldownMs: 0 })),
}));

vi.mock("../../settings/model-pricing.js", () => ({
  calculateCost: vi.fn(() => 0),
}));

vi.mock("../../llm/kimi-tool-parser.js", () => ({
  containsKimiToolMarkup: vi.fn(() => false),
  findToolMarkupStart: vi.fn(() => -1),
  formatToolsForPrompt: vi.fn(() => ""),
  parseKimiToolCalls: vi.fn(() => ({ cleanText: "", toolCalls: [] })),
  usesTextToolCalling: vi.fn(() => false),
}));

vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
}));

vi.mock("../../tools/opencode-client.js", () => ({
  TASK_COMPLETE_SENTINEL: "◊◊TASK_COMPLETE_9f8e7d◊◊",
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    executeTask: vi.fn().mockResolvedValue({ success: true, sessionId: "s", summary: "Done", diff: null }),
  })),
}));

import { TeamLead } from "../team-lead.js";
import type { MessageBus } from "../../bus/message-bus.js";
import type { WorkspaceManager } from "../../workspace/workspace.js";

function createMockBus(): MessageBus {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(() => ({
      id: "msg-1",
      fromAgentId: "",
      toAgentId: "",
      type: "report",
      content: "",
      timestamp: new Date().toISOString(),
    })),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  } as unknown as MessageBus;
}

function createMockWorkspace(): WorkspaceManager {
  return {
    repoPath: vi.fn((projectId: string) => `/workspace/projects/${projectId}/repo`),
    projectPath: vi.fn((projectId: string) => `/workspace/projects/${projectId}`),
    createProject: vi.fn(),
    validateAccess: vi.fn(() => true),
    ensureProject: vi.fn(),
  } as unknown as WorkspaceManager;
}

const PROJECT_ID = "test-github-project";

describe("TeamLead — GitHub context injection", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-gh-tl-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("injects GitHub context into TeamLead system prompt when config exists", () => {
    // Set up GitHub config in KV store
    configStore.set(`project:${PROJECT_ID}:github:repo`, "myorg/myrepo");
    configStore.set(`project:${PROJECT_ID}:github:branch`, "dev");
    configStore.set(`project:${PROJECT_ID}:github:rules`, JSON.stringify(["Sign commits", "Use conventional commits"]));

    const tl = new TeamLead({
      bus,
      workspace: createMockWorkspace(),
      projectId: PROJECT_ID,
      parentId: "coo-1",
    });

    // Access the system prompt via toData()
    const data = tl.toData();
    expect(data.systemPrompt).toContain("myorg/myrepo");
    expect(data.systemPrompt).toContain("dev");
    expect(data.systemPrompt).toContain("PR Workflow");
    expect(data.systemPrompt).toContain("feature branches");
    expect(data.systemPrompt).toContain("Sign commits");
    expect(data.systemPrompt).toContain("Use conventional commits");

    tl.destroy();
  });

  it("does not inject GitHub context when no config exists", () => {
    const tl = new TeamLead({
      bus,
      workspace: createMockWorkspace(),
      projectId: PROJECT_ID,
      parentId: "coo-1",
    });

    const data = tl.toData();
    expect(data.systemPrompt).not.toContain("GitHub Integration");
    expect(data.systemPrompt).not.toContain("PR Workflow");

    tl.destroy();
  });

  it("injects GitHub context without rules when rules are empty", () => {
    configStore.set(`project:${PROJECT_ID}:github:repo`, "org/project");
    configStore.set(`project:${PROJECT_ID}:github:branch`, "main");
    configStore.set(`project:${PROJECT_ID}:github:rules`, JSON.stringify([]));

    const tl = new TeamLead({
      bus,
      workspace: createMockWorkspace(),
      projectId: PROJECT_ID,
      parentId: "coo-1",
    });

    const data = tl.toData();
    expect(data.systemPrompt).toContain("org/project");
    expect(data.systemPrompt).toContain("main");
    expect(data.systemPrompt).not.toContain("Project Rules");

    tl.destroy();
  });

  it("defaults to main when github:branch config is missing", () => {
    configStore.set(`project:${PROJECT_ID}:github:repo`, "org/project");
    // No branch set

    const tl = new TeamLead({
      bus,
      workspace: createMockWorkspace(),
      projectId: PROJECT_ID,
      parentId: "coo-1",
    });

    const data = tl.toData();
    expect(data.systemPrompt).toContain("main");

    tl.destroy();
  });
});

describe("COO — buildRecoveryDirective with GitHub context", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-coo-recovery-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("includes GitHub context in recovery directive when config exists", async () => {
    // Set up GitHub config
    configStore.set(`project:proj-recovery:github:repo`, "myorg/myrepo");
    configStore.set(`project:proj-recovery:github:branch`, "develop");
    configStore.set(`project:proj-recovery:github:rules`, JSON.stringify(["Sign commits"]));

    // Import COO dynamically to get the class
    const { COO } = await import("../coo.js");

    const bus = createMockBus();
    const workspace = createMockWorkspace();

    const coo = new COO({
      bus,
      workspace,
      onAgentSpawned: vi.fn(),
    });

    // Access the private buildRecoveryDirective method
    const directive = (coo as any).buildRecoveryDirective(
      {
        id: "proj-recovery",
        name: "Recovery Project",
        description: "A project being recovered",
        charter: null,
      },
      [], // no tasks
      [], // no recent activity
    );

    expect(directive).toContain("myorg/myrepo");
    expect(directive).toContain("develop");
    expect(directive).toContain("PR WORKFLOW");
    expect(directive).toContain("Sign commits");

    coo.destroy();
  });

  it("does not include GitHub context in recovery directive when no config", async () => {
    const { COO } = await import("../coo.js");

    const bus = createMockBus();
    const workspace = createMockWorkspace();

    const coo = new COO({
      bus,
      workspace,
      onAgentSpawned: vi.fn(),
    });

    const directive = (coo as any).buildRecoveryDirective(
      {
        id: "proj-no-gh",
        name: "No GitHub Project",
        description: "A project without GitHub",
        charter: null,
      },
      [],
      [],
    );

    expect(directive).not.toContain("GITHUB REPO");
    expect(directive).not.toContain("PR WORKFLOW");

    coo.destroy();
  });
});

describe("COO — spawnTeamLeadForManualProject", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-coo-manual-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("spawns a TeamLead and sends a GitHub-aware directive", async () => {
    const { COO } = await import("../coo.js");

    const bus = createMockBus();
    const workspace = createMockWorkspace();
    const spawnedAgents: any[] = [];

    const coo = new COO({
      bus,
      workspace,
      onAgentSpawned: (agent: any) => spawnedAgents.push(agent),
    });

    // Create project record in DB
    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "manual-proj",
        name: "Manual Project",
        description: "test",
        status: "active",
        githubRepo: "org/repo",
        githubBranch: "main",
        rules: ["Sign commits"],
        createdAt: new Date().toISOString(),
      })
      .run();

    await coo.spawnTeamLeadForManualProject("manual-proj", "org/repo", "main", ["Sign commits"]);

    // Verify a TeamLead was spawned
    expect(spawnedAgents.length).toBeGreaterThanOrEqual(1);
    const teamLead = spawnedAgents.find((a) => a.toData().role === "team_lead");
    expect(teamLead).toBeDefined();

    // Verify the directive was sent via bus
    expect(bus.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "directive",
        content: expect.stringContaining("org/repo"),
      }),
    );

    // Check directive content
    const directiveCall = (bus.send as any).mock.calls.find(
      (c: any[]) => c[0].type === "directive" && c[0].content?.includes("org/repo"),
    );
    expect(directiveCall).toBeDefined();
    const content = directiveCall[0].content;
    expect(content).toContain("org/repo");
    expect(content).toContain("main");
    expect(content).toContain("PR Workflow");
    expect(content).toContain("feature branches");
    expect(content).toContain("Sign commits");
    expect(content).toContain("already cloned");

    // Verify TeamLead is tracked
    const teamLeads = coo.getTeamLeads();
    expect(teamLeads.has("manual-proj")).toBe(true);

    coo.destroy();
  });

  it("includes rules in directive only when provided", async () => {
    const { COO } = await import("../coo.js");

    const bus = createMockBus();
    const workspace = createMockWorkspace();

    const coo = new COO({
      bus,
      workspace,
      onAgentSpawned: vi.fn(),
    });

    const db = getDb();
    db.insert(schema.projects)
      .values({
        id: "norules-proj",
        name: "No Rules Project",
        description: "test",
        status: "active",
        createdAt: new Date().toISOString(),
      })
      .run();

    await coo.spawnTeamLeadForManualProject("norules-proj", "org/repo", "dev", []);

    const directiveCall = (bus.send as any).mock.calls.find(
      (c: any[]) => c[0].type === "directive" && c[0].content?.includes("org/repo"),
    );
    expect(directiveCall).toBeDefined();
    const content = directiveCall[0].content;
    expect(content).not.toContain("Project rules");

    coo.destroy();
  });
});
