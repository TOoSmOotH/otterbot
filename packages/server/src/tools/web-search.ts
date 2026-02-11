import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";

export function createWebSearchTool(_ctx: ToolContext) {
  return tool({
    description:
      "Search the web for information. Returns relevant results for the query.",
    parameters: z.object({
      query: z.string().describe("The search query"),
    }),
    execute: async ({ query }) => {
      // TODO: Integrate with a search API (SearXNG, Brave, etc.)
      return `Web search for "${query}" is not yet configured. Please ask the CEO to set up a search provider.`;
    },
  });
}
