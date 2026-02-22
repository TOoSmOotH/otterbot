import { tool } from "ai";
import { z } from "zod";
import { listLocalEvents } from "../calendar/calendar.js";

export function createCalendarListEventsTool() {
  return tool({
    description:
      "List calendar events within a time range. Returns events from both the internal/local calendar and Google Calendar (if connected). Each event has a 'source' field indicating where it came from.",
    parameters: z.object({
      timeMin: z
        .string()
        .optional()
        .describe("Start of time range (ISO datetime). Default: now."),
      timeMax: z
        .string()
        .optional()
        .describe("End of time range (ISO datetime). Default: 7 days from now."),
    }),
    execute: async ({ timeMin, timeMax }) => {
      const now = new Date();
      const effectiveMin = timeMin ?? now.toISOString();
      const effectiveMax =
        timeMax ?? new Date(now.getTime() + 7 * 86400000).toISOString();

      const localEvents = listLocalEvents(effectiveMin, effectiveMax);

      let googleEvents: any[] = [];
      try {
        const { listGoogleEvents } = await import("../google/calendar-client.js");
        googleEvents = await listGoogleEvents(effectiveMin, effectiveMax);
      } catch {
        // Google not connected — that's fine
      }

      const all = [...localEvents, ...googleEvents].sort((a, b) =>
        a.start.localeCompare(b.start),
      );

      if (all.length === 0) {
        return "No events found in the specified time range.";
      }

      return JSON.stringify(all, null, 2);
    },
  });
}
