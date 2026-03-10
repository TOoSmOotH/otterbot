import { tool } from "ai";
import { z } from "zod";
import { listEmails } from "../email/imap-client.js";

export function createEmailListTool() {
  return tool({
    description:
      "List emails from the user's inbox. Returns recent emails, newest first.",
    parameters: z.object({
      query: z
        .string()
        .optional()
        .describe("Search query (currently unused — reserved for future IMAP search)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max emails to return (default: 10)"),
    }),
    execute: async ({ query, maxResults }) => {
      try {
        const result = await listEmails({
          q: query,
          maxResults: String(maxResults ?? 10),
        });
        if (result.messages.length === 0) {
          return "No emails found.";
        }
        const lines = result.messages.map(
          (m) =>
            `- [${m.isUnread ? "UNREAD" : "read"}] ID: ${m.id} | From: ${m.from} | Subject: ${m.subject} | Date: ${m.date}`,
        );
        return lines.join("\n");
      } catch (err) {
        return `Error listing emails: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
