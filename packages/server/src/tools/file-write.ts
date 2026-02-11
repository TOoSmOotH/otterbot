import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, normalize, dirname } from "node:path";
import type { ToolContext } from "./tool-context.js";

export function createFileWriteTool(ctx: ToolContext) {
  return tool({
    description:
      "Write content to a file in your workspace. " +
      "Creates parent directories if needed. Overwrites if file exists. " +
      "Paths are relative to your workspace directory.",
    parameters: z.object({
      path: z
        .string()
        .describe("Relative path to the file within your workspace"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async ({ path, content }) => {
      const absolutePath = resolve(ctx.workspacePath, path);
      const normalized = normalize(absolutePath);

      if (
        !normalized.startsWith(ctx.workspacePath + "/") &&
        normalized !== ctx.workspacePath
      ) {
        return "Error: Access denied — path is outside your workspace.";
      }

      try {
        mkdirSync(dirname(normalized), { recursive: true });
        writeFileSync(normalized, content, "utf-8");
        return `File written: ${path} (${content.length} bytes)`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
