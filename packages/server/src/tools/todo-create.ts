import { tool } from "ai";
import { z } from "zod";
import { createTodo } from "../todos/todos.js";

export function createTodoCreateTool() {
  return tool({
    description:
      "Create a new personal todo for the user.",
    parameters: z.object({
      title: z.string().describe("Title of the todo"),
      description: z.string().optional().describe("Detailed description"),
      priority: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Priority level (default: medium)"),
      dueDate: z
        .string()
        .optional()
        .describe("Due date in ISO format (YYYY-MM-DD or full ISO datetime)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags for categorization"),
    }),
    execute: async ({ title, description, priority, dueDate, tags }) => {
      const todo = createTodo({ title, description, priority, dueDate, tags });
      return `Todo created: "${todo.title}" (ID: ${todo.id}, priority: ${todo.priority}${todo.dueDate ? `, due: ${todo.dueDate}` : ""})`;
    },
  });
}
