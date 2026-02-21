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

// Capture the onEvent callback when OpenCodeClient is constructed
let capturedOnEvent: ((event: { type: string; properties: Record<string, unknown> }) => void) | undefined;

const mockExecuteTask = vi.fn();

vi.mock("../../tools/opencode-client.js", () => {
  return {
    TASK_COMPLETE_SENTINEL: "◊◊TASK_COMPLETE_9f8e7d◊◊",
    OpenCodeClient: class {
      constructor(config: any) {
        if (typeof (globalThis as any).__captureOnEvent === "function") {
          (globalThis as any).__captureOnEvent(config.onEvent);
        }
      }
      executeTask = mockExecuteTask;
    },
  };
});

vi.mock("../../tools/opencode-task.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../tools/opencode-task.js")>();
  return {
    ...original,
    formatOpenCodeResult: vi.fn((result: any) =>
      result.success ? `Done: ${result.summary}` : `Failed: ${result.summary}`,
    ),
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

describe("Worker — onCodingAgentEvent callback", () => {
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
    capturedOnEvent = undefined;
    (globalThis as any).__captureOnEvent = (cb: any) => {
      capturedOnEvent = cb;
    };
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
    delete (globalThis as any).__captureOnEvent;
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
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      summary: "Done",
      diff: null,
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // First event should be __session-start
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].event.type).toBe("__session-start");
    expect(events[0].event.properties.task).toBe("Build it");
    expect(events[0].event.properties.projectId).toBe("proj-1");
    expect(events[0].agentId).toBe(worker.id);
  });

  it("emits __session-end after executeTask completes successfully", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      summary: "Done",
      diff: { files: [{ path: "src/x.ts", additions: 5, deletions: 0 }] },
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // Last event should be __session-end
    const lastEvent = events[events.length - 1];
    expect(lastEvent.event.type).toBe("__session-end");
    expect(lastEvent.sessionId).toBe("sess-1");
    expect(lastEvent.event.properties.status).toBe("completed");
    expect(lastEvent.event.properties.diff).toEqual([
      { path: "src/x.ts", additions: 5, deletions: 0 },
    ]);
  });

  it("emits __session-end with error status on failure", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    mockExecuteTask.mockResolvedValue({
      success: false,
      sessionId: "sess-2",
      summary: "Build failed",
      diff: null,
      error: "compilation_error",
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    const lastEvent = events[events.length - 1];
    expect(lastEvent.event.type).toBe("__session-end");
    expect(lastEvent.event.properties.status).toBe("error");
  });

  it("passes onEvent callback to OpenCodeClient constructor", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const onCodingAgentEvent = vi.fn();

    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      summary: "Done",
      diff: null,
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // The captured onEvent should be a function
    expect(capturedOnEvent).toBeInstanceOf(Function);
  });

  it("forwards SSE events through the callback chain", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    const events: Array<{ agentId: string; sessionId: string; event: any }> = [];
    const onCodingAgentEvent = vi.fn((agentId: string, sessionId: string, event: any) => {
      events.push({ agentId, sessionId, event });
    });

    // Simulate executeTask calling the onEvent callback during execution
    mockExecuteTask.mockImplementation(async () => {
      // Simulate SSE events being fired during task execution
      if (capturedOnEvent) {
        capturedOnEvent({
          type: "message.part.updated",
          properties: { sessionID: "sess-1", delta: "Hello", partID: "p1", messageID: "m1", type: "text" },
        });
        capturedOnEvent({
          type: "session.status",
          properties: { sessionID: "sess-1", status: "active" },
        });
      }
      return {
        success: true,
        sessionId: "sess-1",
        summary: "Done",
        diff: null,
      };
    });

    const worker = createWorker(onCodingAgentEvent);
    await worker.handleMessage(makeDirective(worker.id, "Build it"));

    // Should have: __session-start, 2 SSE events forwarded, __session-end
    expect(events.length).toBe(4);

    // SSE events (in the middle)
    expect(events[1].event.type).toBe("message.part.updated");
    expect(events[2].event.type).toBe("session.status");
  });

  it("does not emit events when onCodingAgentEvent is not provided", async () => {
    mockedGetConfig.mockImplementation((key: string) => {
      if (key === "opencode:api_url") return "http://localhost:3333";
      return undefined;
    });

    mockExecuteTask.mockResolvedValue({
      success: true,
      sessionId: "sess-1",
      summary: "Done",
      diff: null,
    });

    // Create worker without onCodingAgentEvent
    const worker = createWorker(undefined);
    // Should complete without errors
    await expect(
      worker.handleMessage(makeDirective(worker.id, "Build it")),
    ).resolves.toBeUndefined();
  });
});
