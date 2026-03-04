import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRole, MessageType } from "@otterbot/shared";
import { migrateDb, resetDb } from "../../db/index.js";
import type { MessageBus } from "../../bus/message-bus.js";

const mockStream = vi.fn();

vi.mock("../../llm/adapter.js", () => ({
  stream: (...args: unknown[]) => mockStream(...args),
  resolveProviderCredentials: vi.fn(() => ({ type: "anthropic" })),
}));

vi.mock("../../llm/circuit-breaker.js", () => ({
  isProviderAvailable: vi.fn(() => true),
  getCircuitBreaker: vi.fn(() => ({
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    remainingCooldownMs: 0,
  })),
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

vi.mock("../../memory/memory-service.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    search: vi.fn(() => []),
  })),
}));

vi.mock("../../memory/memory-compactor.js", () => ({
  MemoryCompactor: vi.fn().mockImplementation(() => ({
    getRecentEpisodes: vi.fn(() => []),
  })),
}));

vi.mock("../../memory/memory-extractor.js", () => ({
  MemoryExtractor: vi.fn().mockImplementation(() => ({
    extract: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { BaseAgent } from "../agent.js";

class TestAgent extends BaseAgent {
  async handleMessage(): Promise<void> {
    // not used in these tests
  }

  async runThink(message: string, options?: { imageParts?: Array<{ type: "image"; image: URL }> }) {
    return this.think(message, undefined, undefined, undefined, options);
  }

  getHistory() {
    return (this as any).conversationHistory;
  }
}

function createMockBus(): MessageBus {
  return {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    send: vi.fn(() => ({
      id: "msg-1",
      fromAgentId: "agent-1",
      toAgentId: null,
      type: MessageType.Chat,
      content: "",
      metadata: {},
      timestamp: new Date().toISOString(),
    })),
    getHistory: vi.fn(() => ({ messages: [], hasMore: false })),
    request: vi.fn(),
    onBroadcast: vi.fn(),
    offBroadcast: vi.fn(),
  } as unknown as MessageBus;
}

function mockStreamResult(text: string) {
  mockStream.mockResolvedValue({
    fullStream: (async function* () {
      yield { type: "text-delta", textDelta: text };
      yield { type: "finish", finishReason: "stop", usage: {} };
    })(),
    usage: Promise.resolve({ promptTokens: 0, completionTokens: 0 }),
  });
}

describe("BaseAgent think image parts", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-agent-image-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
    mockStream.mockReset();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores plain user content when image parts are not provided", async () => {
    mockStreamResult("plain response");
    const agent = new TestAgent(
      {
        role: AgentRole.COO,
        parentId: null,
        projectId: null,
        model: "test-model",
        provider: "test-provider",
        systemPrompt: "system",
      },
      createMockBus(),
    );

    await agent.runThink("hello world");

    const history = agent.getHistory();
    const userMessage = [...history].reverse().find((m: { role: string }) => m.role === "user");
    expect(userMessage.content).toBe("hello world");

    agent.destroy();
  });

  it("stores multimodal user content when image parts are provided", async () => {
    mockStreamResult("image response");
    const agent = new TestAgent(
      {
        role: AgentRole.COO,
        parentId: null,
        projectId: null,
        model: "test-model",
        provider: "test-provider",
        systemPrompt: "system",
      },
      createMockBus(),
    );

    const imagePart = { type: "image" as const, image: new URL("data:image/png;base64,ZmFrZQ==") };
    await agent.runThink("describe this", { imageParts: [imagePart] });

    const history2 = agent.getHistory();
    const userMessage = [...history2].reverse().find((m: { role: string }) => m.role === "user");
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content).toEqual([
      { type: "text", text: "describe this" },
      imagePart,
    ]);

    expect(mockStream).toHaveBeenCalledTimes(1);
    const streamMessages = mockStream.mock.calls[0][1] as Array<{ role: string; content: unknown }>;
    const streamedUserMessage = [...streamMessages].reverse().find((m: { role: string; content: unknown }) => m.role === "user");
    expect(streamedUserMessage?.content).toEqual([
      { type: "text", text: "describe this" },
      imagePart,
    ]);

    agent.destroy();
  });
});
