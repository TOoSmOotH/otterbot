import type { ContextStatus } from "@otterbot/shared";
import type { AgentRuntime } from "./agent-runtime.js";

/**
 * Bang-commands a human can type in any chat surface (chat platforms and the
 * web chat). Parsing and replies live here so every connector behaves
 * identically. `reset` is intentionally *not* destructive here — the real full
 * reset (which also wipes memory) is a confirm-gated button in the web app.
 */
export type ChatCommand = "context" | "clear" | "reset";

/**
 * Recognize a trailing bang-command. We match the final whitespace-separated
 * token so a leading mention still works (e.g. "@bot !clear"). Returns null for
 * anything that isn't a known command.
 */
export function parseChatCommand(text: string): ChatCommand | null {
  const last = text.trim().toLowerCase().split(/\s+/).pop() ?? "";
  switch (last) {
    case "!context":
      return "context";
    case "!clear":
      return "clear";
    case "!reset":
      return "reset";
    default:
      return null;
  }
}

/**
 * Run a parsed command against the runtime and return the reply text to post
 * back. `context` and `clear` act on the conversation; `reset` only explains
 * that the destructive full reset is web-only (it performs no wipe).
 */
export function handleChatCommand(
  runtime: AgentRuntime,
  conversationId: string,
  cmd: ChatCommand
): string {
  switch (cmd) {
    case "context":
      return formatContextStatus(runtime.contextStatus(conversationId));
    case "clear":
      runtime.resetConversation(conversationId);
      return "🧹 Context cleared — memory kept.";
    case "reset":
      return "🔒 Full reset (including memory) is available only in the web app.";
  }
}

/** One-line, human-readable summary of a conversation's context usage. */
export function formatContextStatus(status: ContextStatus): string {
  const pct =
    status.budgetTokens > 0
      ? Math.round((status.usedTokens / status.budgetTokens) * 100)
      : 0;
  const n = (v: number) => v.toLocaleString("en-US");
  const parts = [
    `📊 Context: ${n(status.usedTokens)} / ${n(status.budgetTokens)} tokens (${pct}%)`,
    `${n(status.messageCount)} messages, ${n(status.compactedMessageCount)} compacted`,
  ];
  if (status.lastCompactedAt) {
    parts.push(`last compacted ${relativeTime(status.lastCompactedAt)}`);
  }
  if (status.overBudget) parts.push("⚠️ over budget");
  return parts.join(" · ");
}

/** Compact "2h ago" style relative time; falls back to the raw value if unparseable. */
function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
