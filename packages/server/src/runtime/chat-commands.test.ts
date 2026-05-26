import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { createTestStack, type TestStack } from "../test/harness.js";
import * as schema from "../db/schema.js";
import { parseChatCommand, formatContextStatus, handleChatCommand } from "./chat-commands.js";

describe("parseChatCommand", () => {
  it("recognizes each command", () => {
    expect(parseChatCommand("!context")).toBe("context");
    expect(parseChatCommand("!clear")).toBe("clear");
    expect(parseChatCommand("!reset")).toBe("reset");
  });

  it("matches the trailing token so a leading mention still works", () => {
    expect(parseChatCommand("Otter Bot: !clear")).toBe("clear");
    expect(parseChatCommand("  @bot   !CONTEXT  ")).toBe("context");
  });

  it("returns null for non-commands", () => {
    expect(parseChatCommand("hello")).toBeNull();
    expect(parseChatCommand("reset the thing")).toBeNull();
    expect(parseChatCommand("clear!")).toBeNull();
    expect(parseChatCommand("")).toBeNull();
  });
});

describe("formatContextStatus", () => {
  it("renders usage with a percentage and counts", () => {
    const text = formatContextStatus({
      budgetTokens: 1000,
      usedTokens: 250,
      recapTokens: 0,
      verbatimTokens: 250,
      messageCount: 4,
      compactedMessageCount: 2,
      overBudget: false,
      lastCompactedAt: null,
    });
    expect(text).toContain("250 / 1,000 tokens (25%)");
    expect(text).toContain("4 messages, 2 compacted");
  });

  it("flags an over-budget conversation", () => {
    const text = formatContextStatus({
      budgetTokens: 100,
      usedTokens: 200,
      recapTokens: 0,
      verbatimTokens: 200,
      messageCount: 10,
      compactedMessageCount: 0,
      overBudget: true,
      lastCompactedAt: null,
    });
    expect(text).toContain("over budget");
  });
});

describe("handleChatCommand / fullReset", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createTestStack();
  }, 60_000);

  afterAll(async () => {
    await stack.cleanup();
  });

  it("chat !reset performs no wipe and returns the web-only message", () => {
    const runtime = stack.orch.getRuntime("coo");
    const ctx = stack.orch.getContext("coo");
    if (!runtime || !ctx) throw new Error("COO runtime/context missing");
    ctx.memory.save({ content: "a fact to keep" });
    const before = ctx.memory.list().length;

    const reply = handleChatCommand(runtime, "conv-x", "reset");

    expect(reply).toContain("web app");
    expect(ctx.memory.list().length).toBe(before); // nothing wiped
  });

  it("fullReset wipes memory and the conversation but keeps skills", () => {
    const runtime = stack.orch.getRuntime("coo");
    const ctx = stack.orch.getContext("coo");
    if (!runtime || !ctx) throw new Error("COO runtime/context missing");

    // Seed memories.
    ctx.memory.save({ content: "remember the alamo" });
    ctx.memory.save({ content: "the otter likes fish" });
    expect(ctx.memory.list().length).toBeGreaterThan(0);

    // Seed a conversation with messages + a recap.
    const conversationId = `conv-reset-${nanoid(6)}`;
    ctx.db.insert(schema.conversations).values({ id: conversationId }).run();
    for (let i = 0; i < 3; i++) {
      ctx.db
        .insert(schema.messages)
        .values({
          id: nanoid(),
          conversationId,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `m${i}`,
          createdAt: new Date(Date.now() + i * 1000).toISOString(),
        })
        .run();
    }
    ctx.db
      .insert(schema.conversationRecaps)
      .values({
        id: nanoid(),
        conversationId,
        recap: "summary",
        keyPoints: ["k"],
        coveredThroughMessageId: "x",
        coveredMessageCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    const skillsBefore = ctx.skills.list().length;

    runtime.fullReset(conversationId);

    // Memory gone — rows, FTS, and vectors.
    expect(ctx.memory.list().length).toBe(0);
    const ftsCount = (
      ctx.sqlite
        .prepare(`SELECT COUNT(*) AS c FROM content_fts WHERE kind = 'memory'`)
        .get() as { c: number }
    ).c;
    expect(ftsCount).toBe(0);

    // Conversation history gone.
    const remaining = ctx.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .all();
    expect(remaining.length).toBe(0);
    const recap = ctx.db
      .select()
      .from(schema.conversationRecaps)
      .where(eq(schema.conversationRecaps.conversationId, conversationId))
      .get();
    expect(recap).toBeUndefined();

    // Skills untouched.
    expect(ctx.skills.list().length).toBe(skillsBefore);
  });
});
