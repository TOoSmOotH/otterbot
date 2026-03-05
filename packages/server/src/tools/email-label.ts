import { tool } from "ai";
import { z } from "zod";

export function createEmailFolderTool() {
  return tool({
    description:
      "Move an email to a different IMAP folder. Common folders: INBOX, Sent, Drafts, Trash, Spam, Archive.",
    parameters: z.object({
      messageId: z.string().describe("The email message ID (UID)"),
      folder: z.string().describe("The target folder to move the message to"),
    }),
    execute: async ({ messageId, folder }) => {
      try {
        const { ImapFlow } = await import("imapflow");
        // This is a placeholder — actual folder move would need the live IMAP connection
        // For now, we use the same pattern as archive
        const { archiveEmail } = await import("../email/imap-client.js");
        if (folder.toLowerCase() === "archive" || folder === "[Gmail]/All Mail") {
          await archiveEmail(messageId);
          return `Email ${messageId} moved to archive.`;
        }
        return `Folder move to "${folder}" is not yet supported. Use the archive tool to archive emails.`;
      } catch (err) {
        return `Error moving email: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
