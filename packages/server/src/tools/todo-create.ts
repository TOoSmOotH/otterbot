import { tool } from "ai";
import { z } from "zod";
import { createTodo } from "../todos/todos.js";

export function createTodoCreateTool() {
  return tool({
    description:
      "Create a new personal todo for the user.",
    parameters: z.object({
      title: z.string().describe("Title of the todo"),
      description: z.string().nullable().optional().describe("Detailed description"),
      priority: z
        .enum(["low", "medium", "high"])
        .nullable()
        .optional()
        .describe("Priority level (default: medium)"),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe("Due date in ISO format (YYYY-MM-DD or full ISO datetime)"),
      tags: z
        .array(z.string())
        .nullable()
        .optional()
        .describe("Tags for categorization"),
      reminderAt: z
        .string()
        .nullable()
        .optional()
        .describe("ISO datetime for reminder notification (e.g. when to remind the user)"),
    }),
    execute: async ({ title, description, priority, dueDate, tags, reminderAt }) => {
      const todo = createTodo({ title, description: description ?? undefined, priority: priority ?? undefined, dueDate: dueDate ?? undefined, tags: tags ?? undefined, reminderAt: reminderAt ?? undefined });
      return `Todo created: "${todo.title}" (ID: ${todo.id}, priority: ${todo.priority}${todo.dueDate ? `, due: ${todo.dueDate}` : ""}${todo.reminderAt ? `, reminder: ${todo.reminderAt}` : ""})`;
    },
  });
}
