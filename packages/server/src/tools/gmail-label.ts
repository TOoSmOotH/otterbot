import { tool } from "ai";
import { z } from "zod";
import { applyLabel, removeLabel, listLabels } from "../google/gmail-client.js";

export function createGmailLabelTool() {
  return tool({
    description:
      "Apply or remove a Gmail label on a message. Use action 'add' or 'remove'. Common labels: INBOX, UNREAD, STARRED, IMPORTANT, SPAM, TRASH.",
    parameters: z.object({
      messageId: z.string().describe("The Gmail message ID"),
      labelId: z.string().describe("The label ID to apply or remove"),
      action: z.enum(["add", "remove"]).describe("Whether to add or remove the label"),
    }),
    execute: async ({ messageId, labelId, action }) => {
      try {
        if (action === "add") {
          await applyLabel(messageId, labelId);
          return `Label "${labelId}" added to message ${messageId}.`;
        } else {
          await removeLabel(messageId, labelId);
          return `Label "${labelId}" removed from message ${messageId}.`;
        }
      } catch (err) {
        return `Error modifying label: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
