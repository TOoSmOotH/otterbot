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
  return `\n\n## Current Date & Time\nToday is ${dateStr}. This timestamp was generated when the system prompt was last refreshed and may be slightly stale — if the user asks for the current time, ALWAYS call the get_current_time tool for an accurate result.\nApproximate time: ${now.toISOString()}`;
}
