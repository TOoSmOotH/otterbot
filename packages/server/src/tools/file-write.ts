import { tool } from "ai";
import { z } from "zod";
import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
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

      // Resolve symlinks in workspace path for accurate comparison
      const resolvedWorkspace = realpathSync(ctx.workspacePath);

      // Pre-check: ensure the normalized path is within workspace before creating dirs
      if (
        !normalized.startsWith(ctx.workspacePath + "/") &&
        normalized !== ctx.workspacePath
      ) {
        return "Error: Access denied — path is outside your workspace.";
      }

      try {
        // Create parent directories, then resolve the parent's real path
        // (the file itself may not exist yet, but the parent must)
        const parentDir = dirname(normalized);
        mkdirSync(parentDir, { recursive: true });
        const realParent = realpathSync(parentDir);

        // Security: ensure the resolved parent is within workspace
        if (
          !realParent.startsWith(resolvedWorkspace + "/") &&
          realParent !== resolvedWorkspace
        ) {
          return "Error: Access denied — path is outside your workspace.";
        }

        const realTarget = resolve(realParent, normalized.split("/").pop()!);
        writeFileSync(realTarget, content, "utf-8");
        return `File written: ${path} (${content.length} bytes)`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
