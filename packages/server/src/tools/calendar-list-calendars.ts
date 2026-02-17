import { tool } from "ai";
import { z } from "zod";

export function createCalendarListCalendarsTool() {
  return tool({
    description:
      "List available calendars. Returns the internal/local calendar and any connected Google Calendars.",
    parameters: z.object({}),
    execute: async () => {
      const calendars: { id: string; name: string; source: string; color?: string }[] = [
        { id: "local", name: "Local Calendar", source: "local" },
      ];

      try {
        const { listCalendars } = await import("../google/calendar-client.js");
        const googleCalendars = await listCalendars();
        calendars.push(...googleCalendars);
      } catch {
        // Google not connected — that's fine
      }

      return JSON.stringify(calendars, null, 2);
    },
  });
}
