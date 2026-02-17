import { tool } from "ai";
import { z } from "zod";
import { updateTodo } from "../todos/todos.js";

export function createTodoUpdateTool() {
  return tool({
    description:
      "Update an existing todo. Can change title, description, status, priority, due date, or tags.",
    parameters: z.object({
      id: z.string().describe("The todo ID to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["todo", "in_progress", "done"])
        .optional()
        .describe("New status"),
      priority: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("New priority"),
      dueDate: z
        .string()
        .nullable()
        .optional()
        .describe("New due date (ISO format), or null to clear"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags"),
    }),
    execute: async ({ id, ...updates }) => {
      const todo = updateTodo(id, updates);
      if (!todo) return `Error: Todo with ID "${id}" not found.`;
      return `Todo updated: "${todo.title}" (status: ${todo.status}, priority: ${todo.priority})`;
    },
  });
}
