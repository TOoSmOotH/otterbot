import { tool } from "ai";
import { z } from "zod";
import { getDb, schema } from "../db/index.js";

export function createScheduleListTool() {
  return tool({
    description:
      "List all scheduled tasks. Scheduled tasks run automatically on a recurring interval. Returns task name, description, message, mode, interval, and enabled status.",
    parameters: z.object({
      enabledOnly: z
        .boolean()
        .optional()
        .describe("If true, only return enabled tasks"),
    }),
    execute: async ({ enabledOnly }) => {
      const db = getDb();
      const tasks = db.select().from(schema.customScheduledTasks).all();
      const filtered = enabledOnly ? tasks.filter((t) => t.enabled) : tasks;
      if (filtered.length === 0) {
        return "No scheduled tasks found.";
      }
      return JSON.stringify(
        filtered.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          message: t.message,
          mode: t.mode,
          intervalMs: t.intervalMs,
          intervalMinutes: Math.round(t.intervalMs / 60000),
          enabled: t.enabled,
          lastRunAt: t.lastRunAt,
          moduleAgentId: t.moduleAgentId,
        })),
        null,
        2,
      );
    },
  });
}
