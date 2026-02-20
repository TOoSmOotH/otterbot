import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../../db/index.js";
import { AgentStatus, MessageType } from "@otterbot/shared";

// --- Mocks ---

// Mock auth module (getConfig)
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

// Mock opencode-client (dynamic import target)
const mockExecuteTask = vi.fn();
vi.mock("../../tools/opencode-client.js", () => ({
  TASK_COMPLETE_SENTINEL: "◊◊TASK_COMPLETE_9f8e7d◊◊",
  OpenCodeClient: vi.fn().mockImplementation(() => ({
    executeTask: mockExecuteTask,
  })),
}));

// Mock opencode-task (formatOpenCodeResult — also dynamic import target)
vi.mock("../../tools/opencode-task.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../tools/opencode-task.js")>();
  return {
    ...original,
    formatOpenCodeResult: vi.fn((result: any) =>
      result.success
        ? `OpenCode task completed successfully.\n\n**Summary:**\n${result.summary}`
        : `OpenCode task failed: ${result.summary}`,
    ),
  };
});

// Mock tool-factory (createTools)
vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
}));

// Mock LLM adapter to prevent real API calls
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

import { Worker } from "../worker.js";
import type { MessageBus } from "../../bus/message-bus.js";
import type { BusMessage } from "@otterbot/shared";
import { getConfig } from "../../auth/auth.js";

const mockedGetConfig = vi.mocked(getConfig);

function makeDirective(toAgentId: string, content: string): BusMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    fromAgentId: "parent-1",
    toAgentId,
    type: MessageType.Directive,
    content,
    metadata: {},
    timestamp: new Date().toISOString(),
  };
}

function createMockBus(): MessageBus {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(() => ({
      id: "msg-1",
      fromAgentId: "",
      toAgentId: "",
      type: MessageType.Report,
      content: "",
      timestamp: new Date().toISOString(),
    })),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  } as unknown as MessageBus;
}

describe("Worker — OpenCode delegation", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-worker-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    bus = createMockBus();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createWorker(overrides: Partial<{ registryEntryId: string; workspacePath: string | null }> = {}) {
    return new Worker({
      bus,
      projectId: "proj-1",
      parentId: "parent-1",
      registryEntryId: overrides.registryEntryId ?? "builtin-opencode-coder",
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      systemPrompt: "You are a worker.",
      workspacePath: overrides.workspacePath ?? "/workspace/project",
      toolNames: ["file_read", "file_write", "shell_exec"],
    });
  }

  it("calls OpenCode directly for builtin-opencode-coder with workspace", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });
    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      summary: "Created feature X",
      diff: { files: [{ path: "src/x.ts", additions: 10, deletions: 0 }] },
    });

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Implement feature X"));

    expect(mockExecuteTask).toHaveBeenCalledOnce();
    // Task should include workspace path context
    const taskArg = mockExecuteTask.mock.calls[0][0] as string;
    expect(taskArg).toContain("/workspace/project");
    expect(taskArg).toContain("Implement feature X");
  });

  it("falls back to think() when api_url not configured", async () => {
    mockedGetConfig.mockReturnValue(undefined);

    const worker = createWorker();
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });

  it("falls back to think() for non-opencode workers", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const worker = createWorker({ registryEntryId: "builtin-coder" });
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });

  it("prepends workspace path to task context", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });
    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-2",
      summary: "Done",
      diff: null,
    });

    const worker = createWorker({ workspacePath: "/my/project" });
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    const taskArg = mockExecuteTask.mock.calls[0][0] as string;
    expect(taskArg).toContain("IMPORTANT: All files must be created/edited inside this directory: /my/project");
    expect(taskArg).toContain("Build it");
  });

  it("catches OpenCode client errors and reports them", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });
    mockExecuteTask.mockRejectedValue(new Error("Connection refused"));

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Do task"));

    // Should have sent a report with error info
    const sendCalls = (bus.send as ReturnType<typeof vi.fn>).mock.calls;
    const reportCall = sendCalls.find(
      (c: any[]) => c[0].type === MessageType.Report,
    );
    expect(reportCall).toBeDefined();
    expect(reportCall![0].content).toContain("WORKER ERROR");
    expect(reportCall![0].content).toContain("Connection refused");
  });

  it("always sends report to parent", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });
    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-3",
      summary: "Done",
      diff: null,
    });

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Task"));

    const sendCalls = (bus.send as ReturnType<typeof vi.fn>).mock.calls;
    const reportCall = sendCalls.find(
      (c: any[]) => c[0].type === MessageType.Report && c[0].toAgentId === "parent-1",
    );
    expect(reportCall).toBeDefined();
  });

  it("sets status to Done after task", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });
    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-4",
      summary: "Done",
      diff: null,
    });

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Task"));

    expect((worker as any).status).toBe(AgentStatus.Done);
  });
});
