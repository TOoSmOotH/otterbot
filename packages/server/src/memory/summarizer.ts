import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import { generateText } from "ai";
import { getDb, schema } from "../db/index.js";
import { llm, hasLlm } from "../llm.js";
import { getMemoryService } from "./memory-service.js";

const SUMMARIZE_PROMPT = `You are a conversation summarizer. Given the transcript below, produce:

1. A concise paragraph (<= 150 words) capturing what the user and assistant did.
2. A JSON array of 0-8 short key points — specific facts, decisions, or task results worth recalling later.

Respond in this exact format:

SUMMARY:
<paragraph>

KEY_POINTS:
<JSON array of strings>`;

export interface SummarizeResult {
  id: string;
  conversationId: string;
  summary: string;
  keyPoints: string[];
}

/**
 * Build a session summary for a conversation and index it in FTS.
 * Invoked when a session closes (idle or explicit). No-op if the conversation
 * has already been summarized or has no messages.
 */
export async function summarizeConversation(conversationId: string): Promise<SummarizeResult | null> {
  const db = getDb();
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

  if (!hasLlm()) {
    // Fallback: store the raw transcript as a summary so FTS still works.
    return persist(conversationId, transcript.slice(0, 1500), []);
  }

  const { text } = await generateText({
    model: llm(),
    system: SUMMARIZE_PROMPT,
    prompt: transcript,
    maxTokens: 800,
  });

  const { summary, keyPoints } = parseSummary(text);
  return persist(conversationId, summary, keyPoints);
}

function persist(conversationId: string, summary: string, keyPoints: string[]): SummarizeResult {
  const db = getDb();
  const id = nanoid();
  db.insert(schema.sessionSummaries)
    .values({
      id,
      conversationId,
      summary,
      keyPoints,
      createdAt: new Date().toISOString(),
    })
    .run();
  getMemoryService().indexFts({
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
