import { tool } from "ai";
import { z } from "zod";
import { getDb, schema } from "../db/index.js";
import { MIN_CUSTOM_TASK_INTERVAL_MS } from "../schedulers/custom-task-scheduler.js";

export function createScheduleCreateTool() {
  return tool({
    description:
      "Create a new scheduled task that runs automatically on a recurring interval. Tasks are stored in the database and persist across restarts. Modes: 'coo-prompt' sends the message to COO as a user prompt, 'coo-background' sends to COO silently (only reports if something noteworthy), 'notification' posts the message to chat directly, 'module-agent' sends to a specific specialist agent.",
    parameters: z.object({
      name: z.string().describe("Name for the scheduled task"),
      message: z
        .string()
        .describe("The message/prompt to send when the task fires"),
      intervalMinutes: z
        .number()
        .describe("How often the task should run, in minutes (minimum 1)"),
      mode: z
        .enum(["coo-prompt", "coo-background", "notification", "module-agent"])
        .optional()
        .describe(
          "How the task message is delivered (default: notification)",
        ),
      description: z
        .string()
        .optional()
        .describe("Optional description of what this task does"),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the task starts enabled (default: true)"),
      moduleAgentId: z
        .string()
        .optional()
        .describe(
          "Module agent ID to target (required when mode is 'module-agent')",
        ),
    }),
    execute: async ({
      name,
      message,
      intervalMinutes,
      mode,
      description,
      enabled,
      moduleAgentId,
    }) => {
      const { nanoid } = await import("nanoid");
      const intervalMs = Math.max(
        intervalMinutes * 60000,
        MIN_CUSTOM_TASK_INTERVAL_MS,
      );
      const now = new Date().toISOString();
      const id = nanoid();
      const task = {
        id,
        name,
        description: description ?? "",
        message,
        mode: (mode ?? "notification") as
          | "coo-prompt"
          | "coo-background"
          | "notification"
          | "module-agent",
        intervalMs,
        enabled: enabled ?? true,
        lastRunAt: null,
        moduleAgentId: moduleAgentId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      const db = getDb();
      db.insert(schema.customScheduledTasks).values(task).run();

      // Note: The scheduler runtime will pick up the new task on next loadAndStart
      // or via the API restart mechanism. The tool just manages the DB record.
      return `Scheduled task created: "${name}" (ID: ${id}, interval: ${intervalMinutes} min, mode: ${task.mode}, enabled: ${task.enabled}). The scheduler will pick up this task automatically.`;
    },
  });
}
