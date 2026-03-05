import { tool } from "ai";
import { z } from "zod";
import { sendEmail } from "../email/imap-client.js";
import { getEmailConnectionConfig } from "../email/email-settings.js";

export function createEmailSendTool() {
  return tool({
    description: "Send a new email from the user's configured email account.",
    parameters: z.object({
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().nullable().optional().describe("CC recipients (comma-separated)"),
      bcc: z.string().nullable().optional().describe("BCC recipients (comma-separated)"),
    }),
    execute: async ({ to, subject, body, cc, bcc }) => {
      try {
        const config = getEmailConnectionConfig();
        if (!config) return "Email not configured. Set up IMAP/SMTP in Settings > Email.";
        const result = await sendEmail(config, { to, subject, body, cc: cc ?? undefined, bcc: bcc ?? undefined });
        return `Email sent successfully. Message ID: ${result.id}`;
      } catch (err) {
        return `Error sending email: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
