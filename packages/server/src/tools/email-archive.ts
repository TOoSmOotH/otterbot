import { tool } from "ai";
import { z } from "zod";
import { archiveEmail } from "../email/imap-client.js";

export function createEmailArchiveTool() {
  return tool({
    description: "Archive an email (moves it out of the inbox).",
    parameters: z.object({
      messageId: z.string().describe("The email message ID to archive"),
    }),
    execute: async ({ messageId }) => {
      try {
        await archiveEmail(messageId);
        return `Email ${messageId} archived successfully.`;
      } catch (err) {
        return `Error archiving email: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
