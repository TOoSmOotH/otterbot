import { tool } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { MIN_CUSTOM_TASK_INTERVAL_MS } from "../schedulers/custom-task-scheduler.js";

export function createScheduleUpdateTool() {
  return tool({
    description:
      "Update an existing scheduled task by ID. Can change name, message, interval, mode, enabled status, or description.",
    parameters: z.object({
      id: z.string().describe("The scheduled task ID to update"),
      name: z.string().optional().describe("New name"),
      message: z
        .string()
        .optional()
        .describe("New message/prompt to send when the task fires"),
      intervalMinutes: z
        .number()
        .optional()
        .describe("New interval in minutes (minimum 1)"),
      mode: z
        .enum(["coo-prompt", "coo-background", "notification", "module-agent"])
        .optional()
        .describe("New delivery mode"),
      description: z.string().optional().describe("New description"),
      enabled: z.boolean().optional().describe("Enable or disable the task"),
      moduleAgentId: z
        .string()
        .nullable()
        .optional()
        .describe("Module agent ID (for module-agent mode), or null to clear"),
    }),
    execute: async ({
      id,
      name,
      message,
      intervalMinutes,
      mode,
      description,
      enabled,
      moduleAgentId,
    }) => {
      const db = getDb();
      const existing = db
        .select()
        .from(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .get();
      if (!existing) {
        return `Error: Scheduled task with ID "${id}" not found.`;
      }
      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (name !== undefined) patch.name = name;
      if (message !== undefined) patch.message = message;
      if (description !== undefined) patch.description = description;
      if (mode !== undefined) patch.mode = mode;
      if (enabled !== undefined) patch.enabled = enabled;
      if (moduleAgentId !== undefined) patch.moduleAgentId = moduleAgentId;
      if (intervalMinutes !== undefined) {
        patch.intervalMs = Math.max(
          intervalMinutes * 60000,
          MIN_CUSTOM_TASK_INTERVAL_MS,
        );
      }
      db.update(schema.customScheduledTasks)
        .set(patch)
        .where(eq(schema.customScheduledTasks.id, id))
        .run();
      const updated = db
        .select()
        .from(schema.customScheduledTasks)
        .where(eq(schema.customScheduledTasks.id, id))
        .get();
      return `Scheduled task updated: "${updated!.name}" (ID: ${id}, enabled: ${updated!.enabled}, interval: ${Math.round(updated!.intervalMs / 60000)} min)`;
    },
  });
}
