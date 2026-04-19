import { nanoid } from "nanoid";
import { streamText, type CoreMessage } from "ai";
import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { llm, hasLlm } from "../llm.js";
import { buildSystemPrompt } from "./prompt.js";
import { buildAgentTools } from "./tools.js";
import type { StreamChunk } from "@otterbot/shared";

export interface RespondArgs {
  conversationId: string;
  userMessage: string;
  onChunk: (chunk: StreamChunk) => void;
}

export interface RespondResult {
  messageId: string;
  finalText: string;
  skillsUsed: string[];
  memoriesUsed: string[];
}

export class ChatAgent {
  async respond(args: RespondArgs): Promise<RespondResult> {
    if (!hasLlm()) {
      args.onChunk({
        kind: "error",
        message:
          "LMSTUDIO_BASE_URL not configured. Start LM Studio locally and set LMSTUDIO_BASE_URL (default http://localhost:1234/v1) and LMSTUDIO_MODEL.",
      });
      return { messageId: "", finalText: "", skillsUsed: [], memoriesUsed: [] };
    }

    const db = getDb();
    await ensureConversation(args.conversationId);
    this.appendMessage(args.conversationId, "user", args.userMessage);

    const history = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, args.conversationId))
      .orderBy(asc(schema.messages.createdAt))
      .all();

    const { system, skillsUsed, memoriesUsed } = buildSystemPrompt({
      userMessage: args.userMessage,
    });

    const coreMessages: CoreMessage[] = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const tools = buildAgentTools();

    const result = streamText({
      model: llm(),
      system,
      messages: coreMessages,
      tools,
      maxSteps: 8,
    });

    let finalText = "";
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          finalText += part.textDelta;
          args.onChunk({ kind: "token", text: part.textDelta });
          break;
        case "tool-call":
          args.onChunk({
            kind: "tool_start",
            id: part.toolCallId,
            name: part.toolName,
            args: part.args,
          });
          break;
        case "tool-result":
          args.onChunk({ kind: "tool_end", id: part.toolCallId, result: part.result });
          break;
        case "error": {
          const message = part.error instanceof Error ? part.error.message : String(part.error);
          args.onChunk({ kind: "error", message });
          break;
        }
        default:
          break;
      }
    }

    const messageId = this.appendMessage(args.conversationId, "assistant", finalText);
    this.touchConversation(args.conversationId);

    return { messageId, finalText, skillsUsed, memoriesUsed };
  }

  appendMessage(conversationId: string, role: "user" | "assistant" | "tool", content: string): string {
    const db = getDb();
    const id = nanoid();
    db.insert(schema.messages)
      .values({
        id,
        conversationId,
        role,
        content,
        createdAt: new Date().toISOString(),
      })
      .run();
    return id;
  }

  touchConversation(id: string) {
    const db = getDb();
    db.update(schema.conversations)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.conversations.id, id))
      .run();
  }
}

export async function ensureConversation(id: string, title: string | null = null): Promise<void> {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id))
    .get();
  if (existing) return;
  const now = new Date().toISOString();
  db.insert(schema.conversations)
    .values({ id, title, createdAt: now, updatedAt: now, closedAt: null })
    .run();
}

let _agent: ChatAgent | null = null;
export function getChatAgent(): ChatAgent {
  if (!_agent) _agent = new ChatAgent();
  return _agent;
}
