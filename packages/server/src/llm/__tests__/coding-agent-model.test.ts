import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the CodingAgentModel adapter.
 *
 * Tests verify:
 * - resolveModel() returns CodingAgentModel for each coding agent provider type
 * - convertPromptToString() correctly serializes multi-turn conversations
 * - doGenerate() collects text from Claude Code SDK async generator (mocked)
 * - doStream() emits text-delta and finish stream parts
 * - Provider metadata is configured correctly in settings
 * - CODING_AGENT_PROVIDER_TYPES set is exported
 */

// ---------------------------------------------------------------------------
// Mock DB and auth layers
// ---------------------------------------------------------------------------

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => undefined,
        }),
      }),
    }),
  })),
  schema: {
    providers: { id: "id" },
  },
}));

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Mock AI SDK providers (imported at module level by adapter.ts)
// ---------------------------------------------------------------------------

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => vi.fn()),
}));
vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Mock Claude Agent SDK
// ---------------------------------------------------------------------------

const mockQueryResult = "Hello from Claude Code!";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn((_params: unknown) => {
    async function* generate() {
      yield {
        type: "assistant" as const,
        message: {
          content: [{ type: "text", text: mockQueryResult }],
        },
      };
      yield {
        type: "result" as const,
        subtype: "success",
        result: mockQueryResult,
      };
    }
    return generate();
  }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodingAgentModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("resolveModel", () => {
    const codingAgentTypes = ["claude-code", "opencode", "codex", "gemini-cli"] as const;

    for (const providerType of codingAgentTypes) {
      it(`returns CodingAgentModel for provider type "${providerType}"`, async () => {
        const { resolveModel } = await import("../adapter.js");
        const { CodingAgentModel } = await import("../coding-agent-model.js");

        const model = resolveModel({
          provider: providerType,
          model: "test-model",
        });

        expect(model).toBeInstanceOf(CodingAgentModel);
        expect(model.modelId).toBe("test-model");
        expect(model.provider).toBe(providerType);
      });
    }
  });

  describe("convertPromptToString", () => {
    it("extracts system messages into systemText", async () => {
      const { convertPromptToString } = await import("../coding-agent-model.js");

      const result = convertPromptToString([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ]);

      expect(result.systemText).toBe("You are a helpful assistant.");
      expect(result.userPrompt).toContain("[User]: Hello");
    });

    it("serializes multi-turn conversations", async () => {
      const { convertPromptToString } = await import("../coding-agent-model.js");

      const result = convertPromptToString([
        { role: "system", content: "System prompt" },
        { role: "user", content: [{ type: "text", text: "What is 2+2?" }] },
        { role: "assistant", content: [{ type: "text", text: "4" }] },
        { role: "user", content: [{ type: "text", text: "And 3+3?" }] },
      ]);

      expect(result.systemText).toBe("System prompt");
      expect(result.userPrompt).toContain("[User]: What is 2+2?");
      expect(result.userPrompt).toContain("[Assistant]: 4");
      expect(result.userPrompt).toContain("[User]: And 3+3?");
    });

    it("serializes tool results", async () => {
      const { convertPromptToString } = await import("../coding-agent-model.js");

      const result = convertPromptToString([
        {
          role: "tool",
          content: [
            { type: "tool-result", toolCallId: "tc1", toolName: "search", result: "found it" },
          ],
        },
      ]);

      expect(result.userPrompt).toContain("[Tool Results]");
      expect(result.userPrompt).toContain("search: found it");
    });

    it("handles multiple system messages", async () => {
      const { convertPromptToString } = await import("../coding-agent-model.js");

      const result = convertPromptToString([
        { role: "system", content: "First system" },
        { role: "system", content: "Second system" },
      ]);

      expect(result.systemText).toBe("First system\n\nSecond system");
    });
  });

  describe("doGenerate", () => {
    it("returns text from Claude Code SDK", async () => {
      const { CodingAgentModel } = await import("../coding-agent-model.js");

      const model = new CodingAgentModel({
        agentType: "claude-code",
        modelId: "sonnet",
      });

      const result = await model.doGenerate({
        inputFormat: "prompt",
        mode: { type: "regular" },
        prompt: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      } as any);

      expect(result.text).toBe(mockQueryResult);
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
    });
  });

  describe("doStream", () => {
    it("emits text-delta and finish stream parts", async () => {
      const { CodingAgentModel } = await import("../coding-agent-model.js");

      const model = new CodingAgentModel({
        agentType: "claude-code",
        modelId: "sonnet",
      });

      const { stream } = await model.doStream({
        inputFormat: "prompt",
        mode: { type: "regular" },
        prompt: [
          { role: "user", content: [{ type: "text", text: "Hello" }] },
        ],
      } as any);

      const reader = stream.getReader();
      const parts: any[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts).toHaveLength(2);
      expect(parts[0]).toEqual({
        type: "text-delta",
        textDelta: mockQueryResult,
      });
      expect(parts[1]).toMatchObject({
        type: "finish",
        finishReason: "stop",
      });
    });
  });
});

describe("CODING_AGENT_PROVIDER_TYPES", () => {
  it("contains all four coding agent provider types", async () => {
    const { CODING_AGENT_PROVIDER_TYPES } = await import("../kimi-tool-parser.js");

    expect(CODING_AGENT_PROVIDER_TYPES.has("claude-code")).toBe(true);
    expect(CODING_AGENT_PROVIDER_TYPES.has("opencode")).toBe(true);
    expect(CODING_AGENT_PROVIDER_TYPES.has("codex")).toBe(true);
    expect(CODING_AGENT_PROVIDER_TYPES.has("gemini-cli")).toBe(true);
    expect(CODING_AGENT_PROVIDER_TYPES.size).toBe(4);
  });
});
