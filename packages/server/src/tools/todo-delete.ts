import { tool } from "ai";
import { z } from "zod";
import { deleteTodo } from "../todos/todos.js";

export function createTodoDeleteTool() {
  return tool({
    description: "Delete a personal todo by ID.",
    parameters: z.object({
      id: z.string().describe("The todo ID to delete"),
    }),
    execute: async ({ id }) => {
      const ok = deleteTodo(id);
      if (!ok) return `Error: Todo with ID "${id}" not found.`;
      return `Todo deleted successfully.`;
    },
  });
}
