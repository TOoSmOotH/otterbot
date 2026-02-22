import { tool } from "ai";
import { z } from "zod";
import { updateLocalEvent } from "../calendar/calendar.js";

export function createCalendarUpdateEventTool() {
  return tool({
    description: "Update an existing calendar event. Specify the source to route to the correct backend.",
    parameters: z.object({
      eventId: z.string().describe("The event ID to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      location: z.string().optional().describe("New location"),
      start: z.string().optional().describe("New start time (ISO datetime)"),
      end: z.string().optional().describe("New end time (ISO datetime)"),
      allDay: z.boolean().optional().describe("Whether this is an all-day event"),
      source: z
        .enum(["local", "google"])
        .optional()
        .describe('Which calendar backend (default: "local")'),
    }),
    execute: async ({ eventId, source, ...updates }) => {
      try {
        if (source === "google") {
          const { updateGoogleEvent } = await import("../google/calendar-client.js");
          const event = await updateGoogleEvent(eventId, updates);
          if (!event) return `Google Calendar event "${eventId}" not found.`;
          return `Google Calendar event updated: "${event.title}"`;
        }
        const event = updateLocalEvent(eventId, updates);
        if (!event) return `Local calendar event "${eventId}" not found.`;
        return `Local calendar event updated: "${event.title}"`;
      } catch (err) {
        return `Error updating event: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
