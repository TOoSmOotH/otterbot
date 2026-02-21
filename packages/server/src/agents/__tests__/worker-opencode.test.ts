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

// Mock opencode-pty-client (dynamic import target)
const mockOpenCodePtyExecuteTask = vi.fn();
vi.mock("../../coding-agents/opencode-pty-client.js", () => {
  return {
    OpenCodePtyClient: class {
      executeTask = mockOpenCodePtyExecuteTask;
      writeInput = vi.fn();
      resize = vi.fn();
      kill = vi.fn();
      gracefulExit = vi.fn();
      getReplayBuffer = vi.fn(() => "");
    },
  };
});

// Mock opencode-manager (ensureOpenCodeConfig — called by PTY client)
vi.mock("../../opencode/opencode-manager.js", () => ({
  ensureOpenCodeConfig: vi.fn(),
  writeOpenCodeConfig: vi.fn(),
}));

// Mock settings (getProviderRow — called by PTY client for API key resolution)
vi.mock("../../settings/settings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../settings/settings.js")>();
  return {
    ...original,
    getProviderRow: vi.fn(() => ({ apiKey: "test-key", type: "anthropic", baseUrl: null })),
  };
});

// Mock claude-code-pty-client
const mockClaudeCodeExecuteTask = vi.fn();
vi.mock("../../coding-agents/claude-code-pty-client.js", () => {
  return {
    ClaudeCodePtyClient: class {
      executeTask = mockClaudeCodeExecuteTask;
      writeInput = vi.fn();
      resize = vi.fn();
      kill = vi.fn();
      gracefulExit = vi.fn();
      getReplayBuffer = vi.fn(() => "");
    },
  };
});

// Mock codex-client
const mockCodexExecuteTask = vi.fn();
vi.mock("../../coding-agents/codex-client.js", () => {
  return {
    CodexClient: class {
      executeTask = mockCodexExecuteTask;
    },
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

  it("calls OpenCode PTY for builtin-opencode-coder with workspace", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "claude-sonnet-4-5-20250929";
      return undefined;
    });
    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-1",
      summary: "Task completed.",
      diff: { files: [{ path: "src/x.ts", additions: 10, deletions: 0 }] },
      usage: null,
    });

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Implement feature X"));

    expect(mockOpenCodePtyExecuteTask).toHaveBeenCalledOnce();
    // Task should be passed directly (no context wrapping — PTY handles task as-is)
    const taskArg = mockOpenCodePtyExecuteTask.mock.calls[0][0] as string;
    expect(taskArg).toBe("Implement feature X");
  });

  it("falls back to think() when OpenCode not configured", async () => {
    mockedGetConfig.mockReturnValue(undefined);

    const worker = createWorker();
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockOpenCodePtyExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });

  it("falls back to think() for non-opencode workers", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });

    const worker = createWorker({ registryEntryId: "builtin-coder" });
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockOpenCodePtyExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });

  it("catches OpenCode PTY errors and reports them", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });
    mockOpenCodePtyExecuteTask.mockRejectedValue(new Error("spawn opencode ENOENT"));

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Do task"));

    // Should have sent a report with error info
    const sendCalls = (bus.send as ReturnType<typeof vi.fn>).mock.calls;
    const reportCall = sendCalls.find(
      (c: any[]) => c[0].type === MessageType.Report,
    );
    expect(reportCall).toBeDefined();
    expect(reportCall![0].content).toContain("WORKER ERROR");
    expect(reportCall![0].content).toContain("spawn opencode ENOENT");
  });

  it("always sends report to parent", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });
    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-2",
      summary: "Task completed.",
      diff: null,
      usage: null,
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
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });
    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-3",
      summary: "Task completed.",
      diff: null,
      usage: null,
    });

    const worker = createWorker();
    await worker.handleMessage(makeDirective(worker.id, "Task"));

    expect((worker as any).status).toBe(AgentStatus.Done);
  });

  // ─── Claude Code dispatch ──────────────────────────────────

  it("calls ClaudeCodeClient for builtin-claude-code-coder", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "claude-code:api_key") return "sk-test-key";
      if (key === "claude-code:auth_mode") return "api-key";
      return undefined;
    });
    mockClaudeCodeExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "cc-sess-1",
      summary: "Created feature Y",
      diff: { files: [{ path: "src/y.ts", additions: 5, deletions: 0 }] },
    });

    const worker = createWorker({ registryEntryId: "builtin-claude-code-coder" });
    await worker.handleMessage(makeDirective(worker.id, "Implement feature Y"));

    expect(mockClaudeCodeExecuteTask).toHaveBeenCalledOnce();
  });

  // ─── Codex dispatch ────────────────────────────────────────

  it("calls CodexClient for builtin-codex-coder", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "codex:api_key") return "sk-codex-key";
      if (key === "codex:auth_mode") return "api-key";
      return undefined;
    });
    mockCodexExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "cx-sess-1",
      summary: "Implemented feature Z",
      diff: { files: [{ path: "src/z.ts", additions: 3, deletions: 0 }] },
    });

    const worker = createWorker({ registryEntryId: "builtin-codex-coder" });
    await worker.handleMessage(makeDirective(worker.id, "Implement feature Z"));

    expect(mockCodexExecuteTask).toHaveBeenCalledOnce();
  });

  // ─── Fallback to think() ───────────────────────────────────

  it("falls back to think() for builtin-claude-code-coder when not configured", async () => {
    mockedGetConfig.mockReturnValue(undefined);

    const worker = createWorker({ registryEntryId: "builtin-claude-code-coder" });
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockClaudeCodeExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });

  it("falls back to think() for builtin-codex-coder when not configured", async () => {
    mockedGetConfig.mockReturnValue(undefined);

    const worker = createWorker({ registryEntryId: "builtin-codex-coder" });
    const thinkSpy = vi.spyOn(worker as any, "think").mockResolvedValue({
      text: "think() result",
      thinking: undefined,
      hadToolCalls: false,
    });

    await worker.handleMessage(makeDirective(worker.id, "Do something"));

    expect(mockCodexExecuteTask).not.toHaveBeenCalled();
    expect(thinkSpy).toHaveBeenCalled();
  });
});
