import { tool } from "ai";
import { z } from "zod";
import { readEmail, sendEmail } from "../google/gmail-client.js";

export function createGmailReplyTool() {
  return tool({
    description: "Reply to an existing email thread.",
    parameters: z.object({
      messageId: z.string().describe("The message ID to reply to"),
      body: z.string().describe("Reply body (plain text)"),
      cc: z.string().nullable().optional().describe("CC recipients (comma-separated)"),
    }),
    execute: async ({ messageId, body, cc }) => {
      try {
        // Read the original to get thread info
        const original = await readEmail(messageId);
        if (!original) return `Original email with ID "${messageId}" not found.`;

        const result = await sendEmail({
          to: original.from,
          subject: original.subject.startsWith("Re:") ? original.subject : `Re: ${original.subject}`,
          body,
          cc: cc ?? undefined,
          inReplyTo: messageId,
          threadId: original.threadId,
        });
        return `Reply sent successfully. Message ID: ${result.id}`;
      } catch (err) {
        return `Error replying to email: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
