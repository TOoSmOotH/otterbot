import { tool } from "ai";
import { z } from "zod";
import { readFileSync, statSync } from "node:fs";
import { resolve, normalize } from "node:path";
import type { ToolContext } from "./tool-context.js";

/** Maximum file size to read (100KB) — prevents blowing up LLM context */
const MAX_READ_SIZE = 100_000;

export function createFileReadTool(ctx: ToolContext) {
  return tool({
    description:
      "Read the contents of a file in your workspace. " +
      "Paths are relative to your workspace directory.",
    parameters: z.object({
      path: z
        .string()
        .describe("Relative path to the file within your workspace"),
    }),
    execute: async ({ path }) => {
      const absolutePath = resolve(ctx.workspacePath, path);
      const normalized = normalize(absolutePath);

      // Security: ensure path stays within workspace
      if (
        !normalized.startsWith(ctx.workspacePath + "/") &&
        normalized !== ctx.workspacePath
      ) {
        return "Error: Access denied — path is outside your workspace.";
      }

      try {
        const stat = statSync(normalized);
        if (stat.size > MAX_READ_SIZE) {
          return `Error: File is too large (${stat.size} bytes). Maximum is ${MAX_READ_SIZE} bytes. Use shell_exec with head/tail/grep to read portions.`;
        }
        return readFileSync(normalized, "utf-8");
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
