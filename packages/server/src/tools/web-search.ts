import { tool } from "ai";
import { z } from "zod";
import { getConfiguredSearchProvider } from "./search/providers.js";
import type { ToolContext } from "./tool-context.js";

export function createWebSearchTool(_ctx: ToolContext) {
  return tool({
    description:
      "Search the web for information. Returns relevant results for the query.",
    parameters: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of results to return (default 5, max 20)"),
    }),
    execute: async ({ query, maxResults }) => {
      const provider = getConfiguredSearchProvider();
      if (!provider) {
        return `Web search for "${query}" is not yet configured. Please ask the CEO to set up a search provider in Settings > Search.`;
      }

      const limit = maxResults ?? 5;

      try {
        const response = await provider.search(query, limit);

        if (response.results.length === 0) {
          return `No results found for "${query}" (provider: ${response.provider}).`;
        }

        const formatted = response.results
          .map(
            (r, i) =>
              `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`,
          )
          .join("\n\n");

        return `Search results for "${query}" (${response.provider}):\n\n${formatted}`;
      } catch (err) {
        return `Search error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
