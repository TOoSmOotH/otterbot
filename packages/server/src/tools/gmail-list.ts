import { tool } from "ai";
import { z } from "zod";
import { listEmails } from "../google/gmail-client.js";

export function createGmailListTool() {
  return tool({
    description:
      "List emails from the user's Gmail inbox. Can search with Gmail query syntax (e.g., 'is:unread', 'from:alice@example.com', 'subject:meeting').",
    parameters: z.object({
      query: z
        .string()
        .optional()
        .describe("Gmail search query (default: 'in:inbox')"),
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
          return "No emails found matching the query.";
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
