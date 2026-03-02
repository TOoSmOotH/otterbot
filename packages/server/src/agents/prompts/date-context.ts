/**
 * Shared helper that builds a date/time context block for agent system prompts.
 */
export function buildDateContext(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `\n\n## Current Date\nToday is ${dateStr}. Current time: ${now.toISOString()}.`;
}
