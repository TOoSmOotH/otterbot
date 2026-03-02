import { tool } from "ai";
import { z } from "zod";
import { getConfig } from "../auth/auth.js";

export function createGetCurrentTimeTool() {
  return tool({
    description: "Get the current date and time. Use this when you need an up-to-date timestamp.",
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      const userTimezone = getConfig("user_timezone");
      const iso = now.toISOString();
      const readable = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const time = now.toLocaleTimeString("en-US");
      let result = `${readable}, ${time} (UTC: ${iso})`;
      if (userTimezone) {
        const localized = now.toLocaleString("en-US", { timeZone: userTimezone });
        result += `\nUser timezone (${userTimezone}): ${localized}`;
      }
      return result;
    },
  });
}
