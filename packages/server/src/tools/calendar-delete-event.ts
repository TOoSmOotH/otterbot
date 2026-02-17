import { tool } from "ai";
import { z } from "zod";
import { deleteLocalEvent } from "../calendar/calendar.js";

export function createCalendarDeleteEventTool() {
  return tool({
    description: "Delete a calendar event by ID. Specify the source to route to the correct backend.",
    parameters: z.object({
      eventId: z.string().describe("The event ID to delete"),
      source: z
        .enum(["local", "google"])
        .optional()
        .describe('Which calendar backend (default: "local")'),
    }),
    execute: async ({ eventId, source }) => {
      try {
        if (source === "google") {
          const { deleteGoogleEvent } = await import("../google/calendar-client.js");
          const ok = await deleteGoogleEvent(eventId);
          if (!ok) return `Google Calendar event "${eventId}" not found.`;
          return "Google Calendar event deleted.";
        }
        const ok = deleteLocalEvent(eventId);
        if (!ok) return `Local calendar event "${eventId}" not found.`;
        return "Local calendar event deleted.";
      } catch (err) {
        return `Error deleting event: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
