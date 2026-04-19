import { asc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { getDb, schema } from "../db/index.js";
import { llm, hasLlm } from "../llm.js";
import { getMemoryService } from "./memory-service.js";
import type { MemoryCategory } from "@otterbot/shared";

const EXTRACT_PROMPT = `You are a memory extractor. Read the transcript and output a JSON array of 0-10 discrete, durable facts about the user that would be useful to recall later. Examples of good facts: "User prefers Python over Ruby", "User is building a rewrite of otterbot", "User works in the US Eastern timezone".

Skip: ephemeral task state, the assistant's own statements, anything already stated as an assumption.

Output ONLY a JSON array, nothing else. Each element has shape:
{"content": string, "category": "preference" | "fact" | "instruction" | "relationship" | "general", "importance": number 1-10}`;

interface ExtractedFact {
  content: string;
  category: MemoryCategory;
  importance: number;
}

export async function extractFactsFromConversation(conversationId: string): Promise<ExtractedFact[]> {
  const db = getDb();
  const messages = db
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

  if (!hasLlm()) return [];

  const { text } = await generateText({
    model: llm(),
    system: EXTRACT_PROMPT,
    prompt: transcript,
    maxTokens: 800,
  });

  const facts = parseFacts(text);
  const mem = getMemoryService();
  for (const f of facts) {
    mem.save({ content: f.content, category: f.category, importance: f.importance, source: "agent" });
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
        valid.push({
          content: String(item.content),
          category: (["preference", "fact", "instruction", "relationship", "general"].includes(item.category)
            ? item.category
            : "general") as MemoryCategory,
          importance: typeof item.importance === "number" ? Math.max(1, Math.min(10, item.importance)) : 5,
        });
      }
    }
    return valid;
  } catch {
    return [];
  }
}
