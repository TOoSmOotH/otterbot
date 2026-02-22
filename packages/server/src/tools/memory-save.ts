import { z } from "zod";
import { tool } from "ai";
import { MemoryService } from "../memory/memory-service.js";

export function createMemorySaveTool() {
  return tool({
    description:
      "Save a memory about the user. Use this when the user explicitly asks you to remember something, " +
      "or when they share important preferences, facts, or instructions that should persist across conversations. " +
      "Examples: 'Remember that I prefer dark mode', 'My dog's name is Max', 'Always use TypeScript for new projects'.",
    parameters: z.object({
      content: z
        .string()
        .describe("The memory content to save — a clear, concise statement of the fact/preference/instruction"),
      category: z
        .enum(["preference", "fact", "instruction", "relationship", "general"])
        .default("general")
        .describe("Category: preference (user likes/dislikes), fact (about user/world), instruction (how to do things), relationship (people/connections), general (other)"),
      importance: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Importance 1-10. Use 8-10 for critical preferences/instructions, 5-7 for useful facts, 1-4 for minor details"),
    }),
    execute: async ({ content, category, importance }) => {
      try {
        const memoryService = new MemoryService();
        const memory = memoryService.save({
          content,
          category,
          importance,
          source: "user",
        });
        return `Memory saved: "${content}" (category: ${category}, importance: ${importance})`;
      } catch (err) {
        return `Failed to save memory: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
