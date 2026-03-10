import { tool } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";

export function createScheduleDeleteTool() {
  return tool({
    description: "Delete a scheduled task by ID. This stops the task and removes it permanently.",
    parameters: z.object({
      id: z.string().describe("The scheduled task ID to delete"),
    }),
    execute: async ({ id }) => {
      const db = getDb();
      const existing = db
        .select()
        .from(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .get();
      if (!existing) {
        return `Error: Scheduled task with ID "${id}" not found.`;
      }
      db.delete(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .run();
      return `Scheduled task "${existing.name}" deleted successfully.`;
    },
  });
}
