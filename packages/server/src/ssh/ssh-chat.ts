/**
 * SSH Chat — AI-assisted terminal interaction.
 *
 * Reads the current terminal buffer from an active SSH PTY session,
 * sends the user's natural-language request + terminal context to an LLM,
 * and streams the response back. The LLM may suggest a command to run
 * in the terminal, which the user can confirm before execution.
 */

import { nanoid } from "nanoid";
import { streamText, type CoreMessage } from "ai";
import { resolveModel, type LLMConfig } from "../llm/adapter.js";
import { getConfig } from "../auth/auth.js";
import { stripAnsi } from "../utils/terminal.js";

const SSH_CHAT_SYSTEM_PROMPT = `You are an AI assistant helping a user interact with a remote server via SSH terminal.

You can see the recent terminal output and the user's request. Your job is to:
1. Understand what the user wants to accomplish
2. If a command needs to be run, include it in a <command> tag like: <command>df -h</command>
3. Provide a brief, helpful explanation of what you're doing or what the output means

Rules:
- Only suggest ONE command at a time
- Never suggest destructive commands (rm -rf /, mkfs, dd if=/dev/zero, etc.) without explicit confirmation context
- For multi-step tasks, handle one step at a time
- When interpreting command output, be concise and highlight the important parts
- If the terminal shows an error, help diagnose it
- If you don't need to run a command (e.g. the user just asked a question about existing output), just respond with your analysis`;

/** Per-session conversation history */
const sessionHistories = new Map<string, CoreMessage[]>();

/** Max terminal context to include (characters) */
const MAX_TERMINAL_CONTEXT = 4000;

/** Extract a command from the LLM response */
function extractCommand(text: string): string | undefined {
  const match = text.match(/<command>([\s\S]*?)<\/command>/);
  return match?.[1]?.trim();
}

/** Strip command tags from display text */
function stripCommandTags(text: string): string {
  return text.replace(/<command>[\s\S]*?<\/command>/g, "").trim();
}

/** Resolve LLM config for SSH chat (reuses COO tier settings) */
function getChatLLMConfig(): LLMConfig {
  const provider = getConfig("coo_provider") ?? "";
  const model = getConfig("coo_model") ?? "claude-sonnet-4-5-20250929";
  return { provider, model };
}

export interface SshChatRequest {
  sessionId: string;
  message: string;
  terminalBuffer: string;
}

export interface SshChatCallbacks {
  onStream: (token: string, messageId: string) => void;
  onComplete: (messageId: string, content: string, command?: string) => void;
  onError: (error: string) => void;
}

export async function handleSshChat(
  req: SshChatRequest,
  callbacks: SshChatCallbacks,
): Promise<string> {
  const messageId = nanoid();

  try {
    const llmConfig = getChatLLMConfig();
    if (!llmConfig.provider) {
      callbacks.onError("No LLM provider configured. Go to Settings to configure one.");
      return messageId;
    }

    const model = resolveModel(llmConfig);

    // Get or create session history
    let history = sessionHistories.get(req.sessionId);
    if (!history) {
      history = [];
      sessionHistories.set(req.sessionId, history);
    }

    // Prepare terminal context (strip ANSI, trim to last N chars)
    const cleanBuffer = stripAnsi(req.terminalBuffer);
    const terminalContext = cleanBuffer.length > MAX_TERMINAL_CONTEXT
      ? cleanBuffer.slice(-MAX_TERMINAL_CONTEXT)
      : cleanBuffer;

    // Build the user message with terminal context
    const userContent = terminalContext
      ? `[Current terminal output (last ${terminalContext.length} chars)]\n\`\`\`\n${terminalContext}\n\`\`\`\n\nUser request: ${req.message}`
      : `User request: ${req.message}`;

    history.push({ role: "user", content: userContent });

    // Keep history manageable (last 20 exchanges)
    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }

    const messages: CoreMessage[] = [
      { role: "system", content: SSH_CHAT_SYSTEM_PROMPT },
      ...history,
    ];

    const result = streamText({
      model,
      messages,
      maxTokens: 1024,
    });

    let fullContent = "";

    for await (const chunk of result.textStream) {
      fullContent += chunk;
      callbacks.onStream(chunk, messageId);
    }

    // Extract command if present
    const command = extractCommand(fullContent);
    const displayContent = stripCommandTags(fullContent);

    // Store assistant response in history
    history.push({ role: "assistant", content: fullContent });

    callbacks.onComplete(messageId, displayContent, command);
    return messageId;
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "SSH chat failed");
    return messageId;
  }
}

/**
 * Automatically analyze the output of a command that was just executed.
 * This injects a synthetic user message into the conversation history
 * and streams the LLM's analysis back to the caller.
 */
export async function analyzeCommandOutput(
  req: { sessionId: string; command: string; terminalBuffer: string },
  callbacks: SshChatCallbacks,
): Promise<string> {
  const message = `The command \`${req.command}\` was just executed. Analyze the output shown in the terminal. Highlight any important results, errors, or warnings. Be concise.`;
  return handleSshChat(
    { sessionId: req.sessionId, message, terminalBuffer: req.terminalBuffer },
    callbacks,
  );
}

/** Clear conversation history for a session */
export function clearSshChatHistory(sessionId: string): void {
  sessionHistories.delete(sessionId);
}
