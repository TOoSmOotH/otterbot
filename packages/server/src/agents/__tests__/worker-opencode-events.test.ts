import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../../db/index.js";
import { MessageType } from "@otterbot/shared";

// --- Mocks ---

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

// Mock opencode-manager
vi.mock("../../opencode/opencode-manager.js", () => ({
  ensureOpenCodeConfig: vi.fn(),
  writeOpenCodeConfig: vi.fn(),
}));

// Mock settings (getProviderRow)
vi.mock("../../settings/settings.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../settings/settings.js")>();
  return {
    ...original,
    getProviderRow: vi.fn(() => ({ apiKey: "test-key", type: "anthropic", baseUrl: null })),
  };
});

vi.mock("../../tools/tool-factory.js", () => ({
  createTools: vi.fn(() => ({})),
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

describe("Worker — OpenCode PTY onCodingAgentEvent callback", () => {
  let tmpDir: string;
  let bus: MessageBus;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-worker-event-test-"));
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

  function createWorker(onCodingAgentEvent?: any) {
    const worker = new Worker({
      bus,
      projectId: "proj-1",
      parentId: "parent-1",
      registryEntryId: "builtin-opencode-coder",
      model: "claude-sonnet-4-5-20250929",
      provider: "anthropic",
      systemPrompt: "You are a worker.",
      workspacePath: "/workspace/project",
      toolNames: [],
      onCodingAgentEvent,
    });
    return worker;
  }

  it("emits __session-start before executeTask", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-1",
      summary: "Task completed.",
      diff: null,
      usage: null,
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // First event should be __session-start
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].event.type).toBe("__session-start");
    expect(events[0].event.properties.task).toBe("Build it");
    expect(events[0].event.properties.projectId).toBe("proj-1");
    expect(events[0].event.properties.agentType).toBe("opencode");
    expect(events[0].agentId).toBe(worker.id);
  });

  it("emits __session-end after executeTask completes successfully", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-1",
      summary: "Task completed.",
      diff: { files: [{ path: "src/x.ts", additions: 5, deletions: 0 }] },
      usage: null,
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // Last event should be __session-end
    const lastEvent = events[events.length - 1];
    expect(lastEvent.event.type).toBe("__session-end");
    expect(lastEvent.sessionId).toBe("opencode-pty-1");
    expect(lastEvent.event.properties.status).toBe("completed");
    expect(lastEvent.event.properties.diff).toEqual([
      { path: "src/x.ts", additions: 5, deletions: 0 },
    ]);
  });

  it("emits __session-end with error status on failure", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: false,
      sessionId: "opencode-pty-2",
      summary: "Process exited with code 1",
      diff: null,
      usage: null,
      error: "exit_code_1",
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event.type).toBe("__session-end");
    expect(lastEvent.event.properties.status).toBe("error");
  });

  it("does not emit events when onCodingAgentEvent is not provided", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:provider_id") return "provider-1";
      if (key === "opencode:model") return "some-model";
      return undefined;
    });

    mockOpenCodePtyExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "opencode-pty-1",
      summary: "Task completed.",
      diff: null,
      usage: null,
    });

    // Create worker without onCodingAgentEvent
    const worker = createWorker(undefined);
    // Should complete without errors
    await expect(
      worker.handleMessage(makeDirective(worker.id, "Build it")),
    ).resolves.toBeUndefined();
  });
});
