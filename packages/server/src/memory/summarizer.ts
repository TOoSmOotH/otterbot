import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import { generateText } from "ai";
import * as schema from "../db/schema.js";
import { resolveChatModel } from "../providers/registry.js";
import type { AgentContext } from "../runtime/agent-context.js";

export const SUMMARIZE_PROMPT = `You are a conversation summarizer. Given the transcript below, produce:

1. A concise paragraph (<= 150 words) capturing what the user and assistant did.
2. A JSON array of 0-8 short key points — specific facts, decisions, or task results worth recalling later.

Respond in this exact format:

SUMMARY:
<paragraph>

KEY_POINTS:
<JSON array of strings>`;

/**
 * Run the summarizer model over an arbitrary transcript and parse its output.
 * Throws on model failure so callers can apply their own fallback. Shared by
 * `summarizeConversation` (end-of-session) and the context manager (compaction).
 */
export async function summarizeText(
  ctx: AgentContext,
  transcript: string
): Promise<{ summary: string; keyPoints: string[] }> {
  const { text } = await generateText({
    model: resolveChatModel(ctx.chatModelRef, ctx.secrets),
    system: SUMMARIZE_PROMPT,
    prompt: transcript,
    maxTokens: 800,
  });
  return parseSummary(text);
}

export interface SummarizeResult {
  id: string;
  conversationId: string;
  summary: string;
  keyPoints: string[];
}

/**
 * Build a session summary for a conversation in the given agent's database and
 * index it in FTS. No-op if already summarized or empty.
 */
export async function summarizeConversation(
  ctx: AgentContext,
  conversationId: string
): Promise<SummarizeResult | null> {
  const db = ctx.db;
  const existing = db
    .select()
    .from(schema.sessionSummaries)
    .where(eq(schema.sessionSummaries.conversationId, conversationId))
    .get();
  if (existing) {
    return {
      id: existing.id,
      conversationId: existing.conversationId,
      summary: existing.summary,
      keyPoints: existing.keyPoints,
    };
  }

  const messages = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all();
  if (messages.length === 0) return null;

  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  try {
    const { summary, keyPoints } = await summarizeText(ctx, transcript);
    return persist(ctx, conversationId, summary, keyPoints);
  } catch (err) {
    console.warn("[summarize] model call failed; storing raw transcript:", err);
    return persist(ctx, conversationId, transcript.slice(0, 1500), []);
  }
}

function persist(
  ctx: AgentContext,
  conversationId: string,
  summary: string,
  keyPoints: string[]
): SummarizeResult {
  const id = nanoid();
  ctx.db
    .insert(schema.sessionSummaries)
    .values({ id, conversationId, summary, keyPoints, createdAt: new Date().toISOString() })
    .run();
  ctx.memory.indexFts({
    kind: "session_summary",
    refId: id,
    title: `Session ${conversationId.slice(0, 8)}`,
    body: [summary, ...keyPoints].join("\n"),
    tags: "",
  });
  return { id, conversationId, summary, keyPoints };
}

export function parseSummary(text: string): { summary: string; keyPoints: string[] } {
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n\s*KEY_POINTS:|$)/i);
  const pointsMatch = text.match(/KEY_POINTS:\s*([\s\S]*)/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : text.trim();
  let keyPoints: string[] = [];
  if (pointsMatch) {
    const raw = pointsMatch[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) keyPoints = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      keyPoints = raw
        .split(/\n+/)
        .map((l) => l.replace(/^[-*\d.\s]+/, "").trim())
        .filter(Boolean);
    }
  }
  return { summary, keyPoints };
}
