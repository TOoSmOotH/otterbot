import { asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import * as schema from "../db/schema.js";
import { resolveChatModel } from "../providers/registry.js";
import type { AgentContext } from "../runtime/agent-context.js";
import type { MemoryCategory } from "@otterbot/shared";

const EXTRACT_PROMPT = `You are a memory extractor. Read the transcript and output a JSON array of 0-10 discrete, durable facts about the user that would be useful to recall later.

Examples of good facts:
- "User prefers Python over Ruby"
- "User is building a rewrite of otterbot"
- "User works in the US Eastern timezone"

Skip: ephemeral task state, the assistant's own statements, anything already stated as an assumption.

Output ONLY a JSON array, nothing else. Each element has shape:
{
  "content": string,
  "category": "preference" | "fact" | "instruction" | "relationship" | "general",
  "importance": number 1-10,
  "entities": string[],
  "temporal": "current" | "past" | "upcoming"
}

Entities should be 1-5 key nouns or phrases extracted from the fact (e.g., ["Python", "programming", "preferences"]).
Temporal should classify whether the fact is about the present ("current"), history ("past"), or future plans ("upcoming").`;

export interface ExtractedFact {
  content: string;
  category: MemoryCategory;
  importance: number;
  entities: string[];
  temporal: "current" | "past" | "upcoming" | null;
}

export async function extractFactsFromConversation(
  ctx: AgentContext,
  conversationId: string
): Promise<ExtractedFact[]> {
  const messages = ctx.db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.createdAt))
    .all();
  if (messages.length === 0) return [];

  const transcript = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  let text: string;
  try {
    const res = await generateText({
      model: resolveChatModel(ctx.profile.model.chat, ctx.secrets),
      system: EXTRACT_PROMPT,
      prompt: transcript,
      maxTokens: 1200,
    });
    text = res.text;
  } catch (err) {
    console.warn("[extract] model call failed:", err);
    return [];
  }

  const facts = parseFacts(text);
  const mem = ctx.memory;
  for (const f of facts) {
    mem.save({
      content: f.content,
      category: f.category,
      importance: f.importance,
      source: "agent",
      entityRefs: f.entities,
      temporalMarker: f.temporal ?? undefined,
    });
  }
  return facts;
}

export function parseFacts(text: string): ExtractedFact[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const valid: ExtractedFact[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof item.content === "string" &&
        item.content.trim().length > 0
      ) {
        const entities = Array.isArray(item.entities)
          ? item.entities.filter((e: unknown) => typeof e === "string")
          : [];
        const temporal = ["current", "past", "upcoming"].includes(item.temporal)
          ? (item.temporal as "current" | "past" | "upcoming")
          : null;
        valid.push({
          content: String(item.content),
          category: (["preference", "fact", "instruction", "relationship", "general"].includes(
            item.category
          )
            ? item.category
            : "general") as MemoryCategory,
          importance: typeof item.importance === "number" ? Math.max(1, Math.min(10, item.importance)) : 5,
          entities,
          temporal,
        });
      }
    }
    return valid;
  } catch {
    return [];
  }
}
