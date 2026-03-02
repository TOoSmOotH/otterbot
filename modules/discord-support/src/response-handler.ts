import { randomUUID } from "node:crypto";
import type { Message as DiscordMessage, ThreadChannel, TextChannel } from "discord.js";
import type { ModuleContext } from "@otterbot/shared";
import type { DiscordSupportClient } from "./discord-client.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_HISTORY_MESSAGES = 20;
const MAX_CODE_RESULTS = 5;
const MAX_CODE_SNIPPET_LENGTH = 4000;
const RESPONSE_COOLDOWN_MS = 10_000; // 10 second cooldown per thread

// ─── Thread state ───────────────────────────────────────────────────────────

const lastResponseTime = new Map<string, number>();

// ─── Database helpers ───────────────────────────────────────────────────────

function ensureThread(
  ctx: ModuleContext,
  channel: ThreadChannel | TextChannel,
  message: DiscordMessage,
): void {
  const channelId = channel.id;
  const existing = ctx.knowledge.db
    .prepare("SELECT thread_id FROM threads WHERE thread_id = ?")
    .get(channelId) as { thread_id: string } | undefined;

  if (!existing) {
    const parentId = channel.isThread() ? (channel as ThreadChannel).parentId ?? "" : channelId;
    ctx.knowledge.db
      .prepare(
        `INSERT INTO threads (thread_id, channel_id, title, author_id, author_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(
        channelId,
        parentId,
        channel.name,
        message.author.id,
        message.author.username,
        new Date().toISOString(),
        new Date().toISOString(),
      );
  } else {
    ctx.knowledge.db
      .prepare("UPDATE threads SET updated_at = ? WHERE thread_id = ?")
      .run(new Date().toISOString(), channelId);
  }
}

function storeMessage(
  ctx: ModuleContext,
  threadId: string,
  discordMessageId: string,
  authorId: string,
  authorName: string,
  isBot: boolean,
  content: string,
): void {
  ctx.knowledge.db
    .prepare(
      `INSERT OR IGNORE INTO thread_messages (id, thread_id, discord_message_id, author_id, author_name, is_bot, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      threadId,
      discordMessageId,
      authorId,
      authorName,
      isBot ? 1 : 0,
      content,
      new Date().toISOString(),
    );
}

interface StoredMessage {
  author_name: string | null;
  is_bot: number;
  content: string;
  created_at: string;
}

function loadThreadHistory(ctx: ModuleContext, threadId: string): StoredMessage[] {
  return ctx.knowledge.db
    .prepare(
      `SELECT author_name, is_bot, content, created_at
       FROM thread_messages
       WHERE thread_id = ?
       ORDER BY created_at ASC`,
    )
    .all(threadId) as StoredMessage[];
}

// ─── Response generation ────────────────────────────────────────────────────

function buildSystemPrompt(
  ctx: ModuleContext,
  threadTitle: string,
  codeContext: string,
): string {
  const botName = ctx.getConfig("bot_name") ?? "Support Bot";
  const repo = ctx.getConfig("github_repo") ?? "the project";

  return [
    `You are ${botName}, a support assistant for the ${repo} project.`,
    "You help users with questions about the codebase by referencing the indexed source code.",
    "",
    "When answering:",
    "- Reference specific file paths when relevant",
    "- Use code blocks with appropriate syntax highlighting",
    "- Be concise but thorough",
    "- If you don't know the answer, say so honestly",
    "- If the question is about a bug, suggest debugging steps",
    "- Format your response for Discord (markdown, keep responses focused)",
    "- If the question has been asked before in past threads, reference the previous answer",
    "",
    `Thread topic: ${threadTitle}`,
    "",
    codeContext
      ? `The following source code files may be relevant:\n\n${codeContext}`
      : "No specific source code context was found for this query. Use the search_code tool if needed.",
  ].join("\n");
}

function buildMessages(
  history: StoredMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  // Take last N messages for context
  const recent = history.slice(-MAX_HISTORY_MESSAGES);

  return recent.map((msg) => ({
    role: msg.is_bot ? ("assistant" as const) : ("user" as const),
    content: msg.is_bot
      ? msg.content
      : `[${msg.author_name ?? "User"}]: ${msg.content}`,
  }));
}

// ─── Main handler ───────────────────────────────────────────────────────────

export async function handleSupportMessage(
  ctx: ModuleContext,
  client: DiscordSupportClient,
  message: DiscordMessage,
  channel: ThreadChannel | TextChannel,
): Promise<void> {
  const channelId = channel.id;

  // Rate limit: don't respond too quickly to the same channel/thread
  const lastTime = lastResponseTime.get(channelId);
  if (lastTime && Date.now() - lastTime < RESPONSE_COOLDOWN_MS) {
    return;
  }

  // Ensure thread record exists
  ensureThread(ctx, channel, message);

  // Store the incoming message
  storeMessage(
    ctx,
    channelId,
    message.id,
    message.author.id,
    message.author.username,
    false,
    message.content,
  );

  // Check if generateResponse is available
  if (!ctx.generateResponse) {
    ctx.error("generateResponse not available — cannot respond to support message");
    return;
  }

  // Start typing indicator
  const typingTimer = await client.sendTyping(channel);

  try {
    // Load conversation history
    const history = loadThreadHistory(ctx, channelId);

    // Search for relevant code context
    const searchQuery = `${channel.name} ${message.content}`;
    const codeResults = await ctx.knowledge.search(searchQuery, MAX_CODE_RESULTS);
    const codeFiles = codeResults.filter((doc) => doc.id.startsWith("file:"));

    const codeContext = codeFiles
      .map((doc) => {
        const path = (doc.metadata?.path as string) ?? doc.id.replace("file:", "");
        const content = doc.content.length > MAX_CODE_SNIPPET_LENGTH
          ? doc.content.slice(0, MAX_CODE_SNIPPET_LENGTH) + "\n... (truncated)"
          : doc.content;
        return `### ${path}\n${content}`;
      })
      .join("\n\n");

    // Build prompt and messages
    const systemPrompt = buildSystemPrompt(ctx, channel.name, codeContext);
    const messages = buildMessages(history);

    // Generate response
    const result = await ctx.generateResponse({
      systemPrompt,
      messages,
    });

    if (!result.text) {
      ctx.warn("Empty response from LLM for channel:", channelId);
      return;
    }

    // Send response
    await client.sendReply(channel, result.text);

    // Store bot response
    storeMessage(
      ctx,
      channelId,
      `bot-${randomUUID()}`,
      client.botUserId ?? "bot",
      ctx.getConfig("bot_name") ?? "Support Bot",
      true,
      result.text,
    );

    // Update thread timestamp
    ctx.knowledge.db
      .prepare("UPDATE threads SET last_responded_at = ?, updated_at = ? WHERE thread_id = ?")
      .run(new Date().toISOString(), new Date().toISOString(), channelId);

    // Record response time for cooldown
    lastResponseTime.set(channelId, Date.now());
  } catch (err) {
    ctx.error("Failed to generate support response:", err);
  } finally {
    clearInterval(typingTimer);
  }
}
