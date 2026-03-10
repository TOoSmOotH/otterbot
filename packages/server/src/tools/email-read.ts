import { tool } from "ai";
import { z } from "zod";
import { readEmail } from "../email/imap-client.js";

export function createEmailReadTool() {
  return tool({
    description: "Read a specific email by its message ID. Returns the full body and metadata.",
    parameters: z.object({
      messageId: z.string().describe("The email message ID (UID)"),
    }),
    execute: async ({ messageId }) => {
      try {
        const email = await readEmail(messageId);
        if (!email) return `Email with ID "${messageId}" not found.`;

        const lines = [
          `Subject: ${email.subject}`,
          `From: ${email.from}`,
          `To: ${email.to}`,
          email.cc ? `Cc: ${email.cc}` : null,
          `Date: ${email.date}`,
          "",
          email.body.slice(0, 10000),
        ].filter(Boolean);

        if (email.attachments.length > 0) {
          lines.push(
            "",
            `Attachments: ${email.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ")}`,
          );
        }

        return lines.join("\n");
      } catch (err) {
        return `Error reading email: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
