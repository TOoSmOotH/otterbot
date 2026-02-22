import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";

// --- Mocks ---

// Mock auth — getConfig returns undefined by default; per-test overrides below
const configStore = new Map<string, string>();
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock search providers (imported at module level in team-lead.ts)
vi.mock("../../tools/search/providers.js", () => ({
  getConfiguredSearchProvider: vi.fn(() => null),
}));

// Mock desktop module
vi.mock("../../desktop/desktop.js", () => ({
  isDesktopEnabled: vi.fn(() => false),
  getDesktopConfig: vi.fn(() => ({})),
}));

// Mock model-packs to return a deterministic value
vi.mock("../../models3d/model-packs.js", () => ({
  getRandomModelPackId: vi.fn(() => "pack-1"),
}));

// Mock LLM adapter
vi.mock("../../llm/adapter.js", () => ({
  stream: vi.fn(),
  resolveProviderCredentials: vi.fn(() => ({ type: "anthropic" })),
}));

// Mock circuit breaker
vi.mock("../../llm/circuit-breaker.js", () => ({
  isProviderAvailable: vi.fn(() => true),
  getCircuitBreaker: vi.fn(() => ({ recordSuccess: vi.fn(), recordFailure: vi.fn(), remainingCooldownMs: 0 })),
}));

// Mock settings/model-pricing
vi.mock("../../settings/model-pricing.js", () => ({
  calculateCost: vi.fn(() => 0),
}));

// Mock kimi-tool-parser
vi.mock("../../llm/kimi-tool-parser.js", () => ({
  containsKimiToolMarkup: vi.fn(() => false),
  findToolMarkupStart: vi.fn(() => -1),
  formatToolsForPrompt: vi.fn(() => ""),
  parseKimiToolCalls: vi.fn(() => ({ cleanText: "", toolCalls: [] })),
  usesTextToolCalling: vi.fn(() => false),
}));

// Mock tool-factory
vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
}));

// Mock opencode-client
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
    validateAccess: vi.fn(() => true),
    ensureProject: vi.fn(),
  } as unknown as WorkspaceManager;
}

const PROJECT_ID = "test-project";

function createTeamLead(bus: MessageBus) {
  return new TeamLead({
    bus,
    workspace: createMockWorkspace(),
    projectId: PROJECT_ID,
    parentId: "coo-1",
  });
}

/** Insert a kanban task directly into the DB */
function insertTask(overrides: Partial<{
  id: string;
  title: string;
  column: "backlog" | "in_progress" | "done";
  description: string;
  assigneeAgentId: string | null;
  position: number;
  blockedBy: string[];
  retryCount: number;
  completionReport: string | null;
}> = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const column = overrides.column ?? "backlog" as const;
  const task = {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT_ID,
    title: overrides.title ?? "Test task",
    description: overrides.description ?? "",
    column: column as "backlog" | "in_progress" | "done",
    position: overrides.position ?? 0,
    assigneeAgentId: overrides.assigneeAgentId ?? null,
    createdBy: "test",
    labels: [],
    blockedBy: overrides.blockedBy ?? [],
    retryCount: overrides.retryCount ?? 0,
    completionReport: overrides.completionReport ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.kanbanTasks).values(task).run();
  return task;
}

function getTask(taskId: string) {
  return getDb()
    .select()
    .from(schema.kanbanTasks)
    .where(eq(schema.kanbanTasks.id, taskId))
    .get();
}

describe("TeamLead — Kanban logic", () => {
  let tmpDir: string;
  let bus: MessageBus;
  let tl: TeamLead;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-tl-test-"));
    resetDb();
    configStore.clear();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();
    tl = createTeamLead(bus);
  });

  afterEach(() => {
    try { tl.destroy(); } catch { /* ignore */ }
    resetDb();
    configStore.clear();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── updateKanbanTask guards ────────────────────────────────

  describe("updateKanbanTask guards", () => {
    it("no-op when already in target column with no other changes", () => {
      const task = insertTask({ column: "done" });
      const result = (tl as any).updateKanbanTask(task.id, { column: "done" });
      expect(result).toContain("already in");
    });

    it("allows done→done with description update", () => {
      const task = insertTask({ column: "done" });
      const result = (tl as any).updateKanbanTask(task.id, {
        column: "done",
        description: "Updated description",
      });
      expect(result).toContain("updated");
      expect(getTask(task.id)?.description).toBe("Updated description");
    });

    it("rejects done→backlog", () => {
      const task = insertTask({ column: "done" });
      const result = (tl as any).updateKanbanTask(task.id, { column: "backlog" });
      expect(result).toContain("REJECTED");
    });

    it("rejects done→in_progress", () => {
      const task = insertTask({ column: "done" });
      const result = (tl as any).updateKanbanTask(task.id, { column: "in_progress" });
      expect(result).toContain("REJECTED");
    });

    it("allows backlog→in_progress", () => {
      const task = insertTask({ column: "backlog" });
      const result = (tl as any).updateKanbanTask(task.id, {
        column: "in_progress",
        assigneeAgentId: "worker-1",
      });
      expect(result).toContain("updated");
      expect(getTask(task.id)?.column).toBe("in_progress");
    });

    it("allows in_progress→done", () => {
      const task = insertTask({ column: "in_progress" });
      const result = (tl as any).updateKanbanTask(task.id, { column: "done" });
      expect(result).toContain("updated");
      expect(getTask(task.id)?.column).toBe("done");
    });

    it("increments retryCount on in_progress→backlog", () => {
      const task = insertTask({ column: "in_progress", retryCount: 0 });
      (tl as any).updateKanbanTask(task.id, {
        column: "backlog",
        assigneeAgentId: "",
      });
      const updated = getTask(task.id);
      expect(updated?.retryCount).toBe(1);
      expect(updated?.column).toBe("backlog");
    });

    it("forces task to done when retries exhausted (MAX_TASK_RETRIES=3)", () => {
      const task = insertTask({ column: "in_progress", retryCount: 2 });
      (tl as any).updateKanbanTask(task.id, {
        column: "backlog",
        assigneeAgentId: "",
      });
      const updated = getTask(task.id);
      // retryCount becomes 3, which >= MAX_TASK_RETRIES, so forced to done
      expect(updated?.retryCount).toBe(3);
      expect(updated?.column).toBe("done");
      expect(updated?.completionReport).toContain("FAILED");
    });
  });

  // ─── ensureTaskMoved safety net ─────────────────────────────

  describe("ensureTaskMoved safety net", () => {
    it("returns false if task already moved (not in in_progress)", () => {
      const task = insertTask({ column: "done" });
      const moved = (tl as any).ensureTaskMoved(task.id, "All good");
      expect(moved).toBe(false);
    });

    it("moves successful task to done", () => {
      const task = insertTask({ column: "in_progress", assigneeAgentId: "worker-1" });
      const moved = (tl as any).ensureTaskMoved(task.id, "Everything works perfectly, feature implemented.");
      expect(moved).toBe(true);
      const updated = getTask(task.id);
      expect(updated?.column).toBe("done");
    });

    it("moves failed task to backlog with enriched description", () => {
      const task = insertTask({
        column: "in_progress",
        assigneeAgentId: "worker-1",
        description: "Original description",
      });
      const moved = (tl as any).ensureTaskMoved(task.id, "WORKER ERROR: Task failed — compilation error");
      expect(moved).toBe(true);
      const updated = getTask(task.id);
      expect(updated?.column).toBe("backlog");
      expect(updated?.description).toContain("PREVIOUS ATTEMPT FAILED");
      expect(updated?.description).toContain("compilation error");
    });

    it("forces failed task to done when retries exhausted", () => {
      const task = insertTask({
        column: "in_progress",
        assigneeAgentId: "worker-1",
        retryCount: 2, // next will be 3 = MAX_TASK_RETRIES
      });
      const moved = (tl as any).ensureTaskMoved(task.id, "WORKER ERROR: still broken");
      expect(moved).toBe(true);
      const updated = getTask(task.id);
      expect(updated?.column).toBe("done");
      expect(updated?.completionReport).toContain("FAILED");
    });

    it("overrides backlog→done when LLM incorrectly moved a successful task", () => {
      const task = insertTask({
        column: "backlog",
        assigneeAgentId: "worker-1",
      });
      const moved = (tl as any).ensureTaskMoved(
        task.id,
        "Task completed.\nPR created: https://github.com/foo/bar/pull/42\n\nTerminal output (last 2000 chars):\nAll tests pass.",
      );
      expect(moved).toBe(true);
      const updated = getTask(task.id);
      expect(updated?.column).toBe("done");
      expect(updated?.completionReport).toContain("PR created");
    });

    it("does not double-increment retryCount", () => {
      // ensureTaskMoved calls updateKanbanTask which increments retryCount.
      // Verify it only increments once (not ensureTaskMoved + updateKanbanTask separately).
      const task = insertTask({
        column: "in_progress",
        assigneeAgentId: "worker-1",
        retryCount: 0,
      });
      (tl as any).ensureTaskMoved(task.id, "WORKER ERROR: failed");
      const updated = getTask(task.id);
      expect(updated?.retryCount).toBe(1); // exactly 1, not 2
    });
  });

  // ─── isFailureReport ────────────────────────────────────────

  describe("isFailureReport", () => {
    it("detects 'WORKER ERROR:' signal", () => {
      expect((tl as any).isFailureReport("WORKER ERROR: Task failed — timeout")).toBe(true);
    });

    it("detects 'exit code: 1' signal", () => {
      expect((tl as any).isFailureReport("Process finished with exit code: 1")).toBe(true);
    });

    it("detects 'error:' signal", () => {
      expect((tl as any).isFailureReport("Something caused an error: bad input")).toBe(true);
    });

    it("detects 'permission denied' signal", () => {
      expect((tl as any).isFailureReport("Permission denied: /etc/shadow")).toBe(true);
    });

    it("returns true for empty report", () => {
      expect((tl as any).isFailureReport("")).toBe(true);
      expect((tl as any).isFailureReport("   ")).toBe(true);
    });

    it("returns false for normal success report", () => {
      expect((tl as any).isFailureReport("Successfully implemented the feature. All tests pass.")).toBe(false);
    });
  });

  // ─── Orphan cleanup (getOrphanedTasks) ──────────────────────

  describe("orphan detection", () => {
    it("identifies in_progress tasks assigned to dead workers as orphans", () => {
      // Insert a task assigned to a worker that doesn't exist in tl.workers
      insertTask({
        id: "orphan-1",
        column: "in_progress",
        assigneeAgentId: "dead-worker-123",
      });
      const orphans = (tl as any).getOrphanedTasks();
      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe("orphan-1");
    });

    it("does not flag tasks assigned to living workers", () => {
      // Add a worker to the team lead's worker map
      const workerId = "living-worker-456";
      (tl as any).workers.set(workerId, { id: workerId, destroy: vi.fn() });

      insertTask({
        id: "active-1",
        column: "in_progress",
        assigneeAgentId: workerId,
      });
      const orphans = (tl as any).getOrphanedTasks();
      expect(orphans).toHaveLength(0);
    });
  });

  // ─── autoSpawnUnblockedTasks ────────────────────────────────

  describe("autoSpawnUnblockedTasks", () => {
    it("skips when max coding workers are already running", async () => {
      (tl as any).workers.set("w-1", { id: "w-1", destroy: vi.fn(), registryEntryId: "builtin-coder" });
      (tl as any).workers.set("w-2", { id: "w-2", destroy: vi.fn(), registryEntryId: "builtin-coder" });
      insertTask({ column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker");
      await (tl as any).autoSpawnUnblockedTasks();
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips when no unblocked backlog tasks", async () => {
      // Only done tasks
      insertTask({ column: "done" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker");
      await (tl as any).autoSpawnUnblockedTasks();
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("skips when all backlog tasks are blocked", async () => {
      const blocker = insertTask({ id: "blocker-1", column: "in_progress" });
      insertTask({ column: "backlog", blockedBy: ["blocker-1"] });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker");
      await (tl as any).autoSpawnUnblockedTasks();
      expect(spawnSpy).not.toHaveBeenCalled();
    });

    it("spawns workers for unblocked backlog tasks in position order", async () => {
      insertTask({ id: "task-a", title: "Task A", column: "backlog", position: 1 });
      insertTask({ id: "task-b", title: "Task B", column: "backlog", position: 0 }); // lower position

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledTimes(2);
      // First spawn should be task-b (position 0), then task-a (position 1)
      expect(spawnSpy.mock.calls[0][1]).toContain("Task B");
      expect(spawnSpy.mock.calls[1][1]).toContain("Task A");
    });

    it("uses opencode-coder when opencode:enabled is true", async () => {
      configStore.set("opencode:enabled", "true");
      insertTask({ id: "task-x", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-opencode-coder", expect.any(String), "task-x");
    });

    it("uses regular coder when opencode:enabled is not set", async () => {
      insertTask({ id: "task-y", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-coder", expect.any(String), "task-y");
    });

    it("uses claude-code-coder when claude-code:enabled is true and opencode is not", async () => {
      configStore.set("claude-code:enabled", "true");
      insertTask({ id: "task-cc", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-claude-code-coder", expect.any(String), "task-cc");
    });

    it("uses codex-coder when codex:enabled is true and others are not", async () => {
      configStore.set("codex:enabled", "true");
      insertTask({ id: "task-cx", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-codex-coder", expect.any(String), "task-cx");
    });

    it("prefers opencode over claude-code when both enabled", async () => {
      configStore.set("opencode:enabled", "true");
      configStore.set("claude-code:enabled", "true");
      insertTask({ id: "task-both1", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-opencode-coder", expect.any(String), "task-both1");
    });

    it("prefers claude-code over codex when both enabled", async () => {
      configStore.set("claude-code:enabled", "true");
      configStore.set("codex:enabled", "true");
      insertTask({ id: "task-both2", title: "Code task", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-claude-code-coder", expect.any(String), "task-both2");
    });

    it("uses browser-agent for tasks mentioning Chrome/browser instead of coding agent", async () => {
      configStore.set("opencode:enabled", "true");
      insertTask({ id: "task-br1", title: "Launch Chrome and navigate to dashboard", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-browser-agent", expect.any(String), "task-br1");
    });

    it("uses browser-agent for tasks mentioning desktop app", async () => {
      configStore.set("opencode:enabled", "true");
      insertTask({ id: "task-br2", title: "Open desktop app and take screenshot", column: "backlog" });

      const spawnSpy = vi.spyOn(tl as any, "spawnWorker").mockResolvedValue("Spawned");
      await (tl as any).autoSpawnUnblockedTasks();

      expect(spawnSpy).toHaveBeenCalledWith("builtin-browser-agent", expect.any(String), "task-br2");
    });
  });

  // ─── searchRegistry ─────────────────────────────────────────

  describe("searchRegistry", () => {
    it("hides builtin-coder when opencode is enabled", () => {
      configStore.set("opencode:enabled", "true");
      const result = (tl as any).searchRegistry("code");
      expect(result).not.toContain("builtin-coder");
    });

    it("shows builtin-coder when no external agent is enabled", () => {
      const result = (tl as any).searchRegistry("code");
      expect(result).toContain("builtin-coder");
    });

    it("hides disabled external agents", () => {
      configStore.set("opencode:enabled", "true");
      const result = (tl as any).searchRegistry("code");
      expect(result).not.toContain("builtin-claude-code-coder");
      expect(result).not.toContain("builtin-codex-coder");
    });

    it("shows only enabled external agents", () => {
      configStore.set("claude-code:enabled", "true");
      const result = (tl as any).searchRegistry("code");
      expect(result).toContain("builtin-claude-code-coder");
      expect(result).not.toContain("builtin-opencode-coder");
      expect(result).not.toContain("builtin-codex-coder");
    });
  });
});
