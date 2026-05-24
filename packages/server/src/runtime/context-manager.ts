import { nanoid } from "nanoid";
import { eq, asc } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CoreMessage, FilePart, ImagePart, TextPart } from "ai";
import * as schema from "../db/schema.js";
import { summarizeText } from "../memory/summarizer.js";
import type { AgentContext } from "./agent-context.js";
import type { Artifact, ContextStatus } from "@otterbot/shared";

/** Rough char-per-token ratio — good enough for budgeting without a tokenizer. */
export const CHARS_PER_TOKEN = 4;
/** Fallback context window when neither the agent nor global settings set one. */
export const DEFAULT_CONTEXT_WINDOW = 16_000;
/**
 * Fraction of the model's context window kept for live conversation history
 * (recap + verbatim window). The remainder is reserved for the system prompt,
 * tool definitions, and the model's reply.
 */
export const HISTORY_BUDGET_FRACTION = 0.75;
/** Compact once usage reaches this fraction of the budget. */
export const COMPACT_WATERMARK = 0.8;
/** Recent turns always kept verbatim, never folded into the recap. */
export const KEEP_RECENT_MESSAGES = 8;
/** Per-message framing overhead added to the char estimate. */
const PER_MESSAGE_OVERHEAD = 4;

/**
 * The live-history token budget for an agent, derived from its (resolved)
 * chat-model context window.
 */
export function historyBudget(ctx: AgentContext): number {
  return Math.round(ctx.contextWindow * HISTORY_BUDGET_FRACTION);
}

type MessageRow = typeof schema.messages.$inferSelect;
type RecapRow = typeof schema.conversationRecaps.$inferSelect;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(rows: Array<{ content: string }>): number {
  return rows.reduce((sum, m) => sum + estimateTokens(m.content) + PER_MESSAGE_OVERHEAD, 0);
}

/** Conversation messages that go to the model — user/assistant turns, in order. */
function loadChatMessages(ctx: AgentContext, conversationId: string): MessageRow[] {
  return ctx.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all()
    .filter((m) => m.role === "user" || m.role === "assistant");
}

function loadRecap(ctx: AgentContext, conversationId: string): RecapRow | undefined {
  return ctx.db
    .select()
    .from(schema.conversationRecaps)
    .where(eq(schema.conversationRecaps.conversationId, conversationId))
    .get();
}

/** Messages after the compaction watermark — the turns still kept verbatim. */
function verbatimWindow(messages: MessageRow[], recap: RecapRow | undefined): MessageRow[] {
  if (!recap) return messages;
  const idx = messages.findIndex((m) => m.id === recap.coveredThroughMessageId);
  return idx >= 0 ? messages.slice(idx + 1) : messages;
}

/** Render a recap row as a single prompt block: paragraph + key-point bullets. */
function formatRecap(recap: RecapRow): string {
  const points = recap.keyPoints.length
    ? "\n\n" + recap.keyPoints.map((p) => `- ${p}`).join("\n")
    : "";
  return recap.recap + points;
}

/** Token-budget accounting for a conversation's live context window. */
export function contextStatus(ctx: AgentContext, conversationId: string): ContextStatus {
  const messages = loadChatMessages(ctx, conversationId);
  const recap = loadRecap(ctx, conversationId);
  const verbatim = verbatimWindow(messages, recap);
  const recapTokens = recap ? estimateTokens(formatRecap(recap)) : 0;
  const verbatimTokens = estimateMessagesTokens(verbatim);
  const usedTokens = recapTokens + verbatimTokens;
  const budgetTokens = historyBudget(ctx);
  return {
    budgetTokens,
    usedTokens,
    recapTokens,
    verbatimTokens,
    messageCount: messages.length,
    compactedMessageCount: recap?.coveredMessageCount ?? 0,
    overBudget: usedTokens > budgetTokens,
    lastCompactedAt: recap?.updatedAt ?? null,
  };
}

/**
 * Build the bounded context for one turn: the compacted recap (if any) plus
 * only the verbatim window of recent messages. Replaces loading all history.
 */
export function buildContext(
  ctx: AgentContext,
  conversationId: string
): { recapText: string | null; messages: CoreMessage[] } {
  const messages = loadChatMessages(ctx, conversationId);
  const recap = loadRecap(ctx, conversationId);
  const verbatim = verbatimWindow(messages, recap);
  return {
    recapText: recap ? formatRecap(recap) : null,
    messages: verbatim.map(
      (m) =>
        ({
          role: m.role as "user" | "assistant",
          content: messageContent(ctx, m),
        }) as CoreMessage
    ),
  };
}

/**
 * Build a message's model content. Plain text unless the (user) message has
 * uploaded attachments — then it becomes a multimodal part array: the text
 * (plus a reference block so the agent can route/read files by URL), image
 * parts for images, and file parts for PDFs. Text-like docs are left for the
 * agent to fetch via `read_file`. Reads bytes from the agent's own files dir;
 * anything that can't be read is skipped.
 */
function messageContent(
  ctx: AgentContext,
  m: MessageRow
): string | Array<TextPart | ImagePart | FilePart> {
  const attachments = (m.attachments as Artifact[] | null) ?? null;
  if (m.role !== "user" || !attachments || attachments.length === 0) return m.content;

  const refs = attachments.map((a) => `- ${a.name} — ${a.url}`).join("\n");
  const parts: Array<TextPart | ImagePart | FilePart> = [
    {
      type: "text",
      text: `${m.content}\n\n---\nAttached files (use the read_file tool to read text files):\n${refs}`,
    },
  ];
  for (const a of attachments) {
    const path = artifactLocalPath(ctx, a);
    if (!path) continue;
    try {
      if (a.kind === "image" || a.mimeType.startsWith("image/")) {
        parts.push({ type: "image", image: readFileSync(path), mimeType: a.mimeType });
      } else if (a.mimeType === "application/pdf") {
        parts.push({ type: "file", data: readFileSync(path), mimeType: "application/pdf" });
      }
    } catch {
      /* unreadable upload — skip; the reference is still in the text */
    }
  }
  return parts;
}

/** Resolve an uploaded artifact URL to a path within this agent's files dir. */
function artifactLocalPath(ctx: AgentContext, a: Artifact): string | null {
  const match = a.url.match(/\/files\/([^/?#]+)$/);
  if (!match) return null;
  return join(ctx.filesDir, basename(match[1]));
}

/**
 * Fold the oldest uncompacted turns into the recap, keeping the most recent
 * `KEEP_RECENT_MESSAGES` verbatim. The prior recap is fed back in so the
 * summary stays cumulative. No-op when under the watermark (unless `force`d) or
 * when too few turns exist to compact. Returns the updated status.
 */
export async function compactConversation(
  ctx: AgentContext,
  conversationId: string,
  opts: { force?: boolean } = {}
): Promise<ContextStatus> {
  const before = contextStatus(ctx, conversationId);
  if (!opts.force && before.usedTokens < before.budgetTokens * COMPACT_WATERMARK) {
    return before;
  }

  const messages = loadChatMessages(ctx, conversationId);
  const recap = loadRecap(ctx, conversationId);
  const verbatim = verbatimWindow(messages, recap);
  if (verbatim.length <= KEEP_RECENT_MESSAGES) return before;

  const toSummarize = verbatim.slice(0, verbatim.length - KEEP_RECENT_MESSAGES);

  const parts: string[] = [];
  if (recap) parts.push(`PREVIOUS RECAP:\n${recap.recap}`);
  for (const m of toSummarize) parts.push(`${m.role.toUpperCase()}: ${m.content}`);
  const transcript = parts.join("\n\n");

  let summary: string;
  let keyPoints: string[];
  try {
    const res = await summarizeText(ctx, transcript);
    summary = res.summary;
    keyPoints = res.keyPoints;
  } catch (err) {
    console.warn("[compact] summarize failed; storing truncated transcript:", err);
    summary = transcript.slice(0, 1500);
    keyPoints = recap?.keyPoints ?? [];
  }

  const now = new Date().toISOString();
  const watermark = toSummarize[toSummarize.length - 1].id;
  const coveredCount = (recap?.coveredMessageCount ?? 0) + toSummarize.length;

  if (recap) {
    ctx.db
      .update(schema.conversationRecaps)
      .set({
        recap: summary,
        keyPoints,
        coveredThroughMessageId: watermark,
        coveredMessageCount: coveredCount,
        updatedAt: now,
      })
      .where(eq(schema.conversationRecaps.id, recap.id))
      .run();
  } else {
    ctx.db
      .insert(schema.conversationRecaps)
      .values({
        id: nanoid(),
        conversationId,
        recap: summary,
        keyPoints,
        coveredThroughMessageId: watermark,
        coveredMessageCount: coveredCount,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  ctx.db
    .update(schema.conversations)
    .set({ lastCompactedAt: now })
    .where(eq(schema.conversations.id, conversationId))
    .run();

  return contextStatus(ctx, conversationId);
}

/**
 * Compact a conversation if it has crossed the watermark. Errors are logged,
 * never thrown — a chat turn must never fail because compaction failed.
 */
export async function maybeAutoCompact(
  ctx: AgentContext,
  conversationId: string
): Promise<void> {
  try {
    const status = contextStatus(ctx, conversationId);
    if (status.usedTokens >= status.budgetTokens * COMPACT_WATERMARK) {
      await compactConversation(ctx, conversationId);
    }
  } catch (err) {
    console.warn("[context] auto-compact failed:", err);
  }
}
