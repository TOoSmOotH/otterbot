import { tool } from "ai";
import { z } from "zod";
import { createLocalEvent } from "../calendar/calendar.js";

export function createCalendarCreateEventTool() {
  return tool({
    description:
      'Create a new calendar event. Use source "local" for the internal calendar (default) or "google" for Google Calendar.',
    parameters: z.object({
      title: z.string().describe("Event title"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      start: z.string().describe("Start time (ISO datetime)"),
      end: z.string().describe("End time (ISO datetime)"),
      allDay: z.boolean().optional().describe("Whether this is an all-day event"),
      source: z
        .enum(["local", "google"])
        .optional()
        .describe('Which calendar to create in (default: "local")'),
    }),
    execute: async ({ title, description, location, start, end, allDay, source }) => {
      try {
        if (source === "google") {
          const { createGoogleEvent } = await import("../google/calendar-client.js");
          const event = await createGoogleEvent({ title, description, location, start, end, allDay });
          return `Google Calendar event created: "${event.title}" (ID: ${event.id})`;
        }
        const event = createLocalEvent({ title, description, location, start, end, allDay });
        return `Local calendar event created: "${event.title}" (ID: ${event.id})`;
      } catch (err) {
        return `Error creating event: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
