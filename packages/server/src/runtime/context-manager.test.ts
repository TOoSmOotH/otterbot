import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { createTestStack, type TestStack } from "../test/harness.js";
import * as schema from "../db/schema.js";
import type { AgentContext } from "./agent-context.js";
import {
  estimateTokens,
  contextStatus,
  buildContext,
  compactConversation,
  maybeAutoCompact,
  KEEP_RECENT_MESSAGES,
} from "./context-manager.js";

/** Seed a conversation with `count` alternating user/assistant messages. */
function seedConversation(ctx: AgentContext, count: number, charsPerMessage = 20): string {
  const conversationId = `conv-test-${nanoid(6)}`;
  const now = Date.now();
  ctx.db.insert(schema.conversations).values({ id: conversationId }).run();
  for (let i = 0; i < count; i++) {
    ctx.db
      .insert(schema.messages)
      .values({
        id: nanoid(),
        conversationId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `m${i} `.padEnd(charsPerMessage, "x"),
        createdAt: new Date(now + i * 1000).toISOString(),
      })
      .run();
  }
  return conversationId;
}

describe("context-manager", () => {
  let stack: TestStack;
  let ctx: AgentContext;

  beforeAll(async () => {
    stack = await createTestStack();
    const c = stack.orch.getContext("coo");
    if (!c) throw new Error("COO context missing");
    ctx = c;
  }, 60_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("estimateTokens scales with text length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("contextStatus reports usage for an uncompacted conversation", () => {
    const conversationId = seedConversation(ctx, 4);
    const status = contextStatus(ctx, conversationId);
    expect(status.messageCount).toBe(4);
    expect(status.usedTokens).toBeGreaterThan(0);
    expect(status.recapTokens).toBe(0);
    expect(status.compactedMessageCount).toBe(0);
    expect(status.overBudget).toBe(false);
  });

  it("compactConversation folds older turns into a recap", async () => {
    const total = KEEP_RECENT_MESSAGES + 12;
    const conversationId = seedConversation(ctx, total);

    const status = await compactConversation(ctx, conversationId, { force: true });
    expect(status.compactedMessageCount).toBe(total - KEEP_RECENT_MESSAGES);
    expect(status.recapTokens).toBeGreaterThan(0);

    const { recapText, messages } = buildContext(ctx, conversationId);
    expect(recapText).toBeTruthy();
    expect(messages).toHaveLength(KEEP_RECENT_MESSAGES);
  }, 60_000);

  it("compactConversation is a no-op when under budget without force", async () => {
    const conversationId = seedConversation(ctx, 4);
    const status = await compactConversation(ctx, conversationId);
    expect(status.compactedMessageCount).toBe(0);
    expect(buildContext(ctx, conversationId).recapText).toBeNull();
  });

  it("maybeAutoCompact compacts once the conversation crosses the budget", async () => {
    // ~500 tokens/message * 24 messages comfortably exceeds the 12k budget.
    const total = KEEP_RECENT_MESSAGES + 16;
    const conversationId = seedConversation(ctx, total, 2000);
    expect(contextStatus(ctx, conversationId).overBudget).toBe(true);

    await maybeAutoCompact(ctx, conversationId);

    const status = contextStatus(ctx, conversationId);
    expect(status.compactedMessageCount).toBe(total - KEEP_RECENT_MESSAGES);
  }, 60_000);
});
