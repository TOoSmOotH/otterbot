import { tool } from "ai";
import { z } from "zod";
import { archiveEmail } from "../google/gmail-client.js";

export function createGmailArchiveTool() {
  return tool({
    description: "Archive an email (removes it from the inbox but doesn't delete it).",
    parameters: z.object({
      messageId: z.string().describe("The Gmail message ID to archive"),
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
