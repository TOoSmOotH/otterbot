import { tool } from "ai";
import { z } from "zod";
import { listTodos } from "../todos/todos.js";

export function createTodoListTool() {
  return tool({
    description:
      "List the user's personal todos. Can filter by status (todo/in_progress/done) and priority (low/medium/high).",
    parameters: z.object({
      status: z
        .enum(["todo", "in_progress", "done"])
        .optional()
        .describe("Filter by status"),
      priority: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Filter by priority"),
    }),
    execute: async ({ status, priority }) => {
      const todos = listTodos({ status, priority });
      if (todos.length === 0) {
        return "No todos found matching the criteria.";
      }
      return JSON.stringify(todos, null, 2);
    },
  });
}
