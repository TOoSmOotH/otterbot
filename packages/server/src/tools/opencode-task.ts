import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./tool-context.js";
import { OpenCodeClient } from "./opencode-client.js";
import { getConfig } from "../auth/auth.js";

const DEFAULT_TIMEOUT = 180_000; // 3 minutes
const DEFAULT_MAX_ITERATIONS = 50;

export function createOpenCodeTaskTool(ctx: ToolContext) {
  return tool({
    description:
      "Delegate a complex coding task to OpenCode (autonomous AI coding agent). " +
      "OpenCode will autonomously plan, write, and edit files to accomplish the task. " +
      "Use this for multi-file implementations, refactoring, and complex code changes. " +
      "Provide a clear, detailed task description.",
    parameters: z.object({
      task: z
        .string()
        .describe(
          "A clear, detailed description of the coding task to delegate to OpenCode",
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          "Idle timeout in milliseconds — abort after this long with no activity (default: 180000). OpenCode can run much longer as long as it's actively working.",
        ),
    }),
    execute: async ({ task, timeoutMs }) => {
      // Read config from KV store on each invocation
      const apiUrl = getConfig("opencode:api_url");
      const username = getConfig("opencode:username") ?? undefined;
      const password = getConfig("opencode:password") ?? undefined;
      const configTimeout = parseInt(
        getConfig("opencode:timeout_ms") ?? String(DEFAULT_TIMEOUT),
        10,
      );
      const maxIterations = parseInt(
        getConfig("opencode:max_iterations") ?? String(DEFAULT_MAX_ITERATIONS),
        10,
      );

      if (!apiUrl) {
        return (
          "OpenCode is not configured. Set the API URL in Settings > OpenCode. " +
          "OpenCode must be running (`opencode serve`) for this tool to work."
        );
      }

      const effectiveTimeout = timeoutMs ?? configTimeout;

      const client = new OpenCodeClient({
        apiUrl,
        username,
        password,
        timeoutMs: effectiveTimeout,
        maxIterations,
      });

      try {
        // Inject workspace path so OpenCode creates files in the correct location
        const taskWithContext = ctx.workspacePath
          ? `IMPORTANT: All files must be created/edited inside this directory: ${ctx.workspacePath}\n` +
            `Use absolute paths rooted at ${ctx.workspacePath} (e.g. ${ctx.workspacePath}/src/main.go).\n` +
            `Do NOT use /home/user, /app, or any other directory.\n\n${task}`
          : task;

        console.log(`[opencode_task] Sending task to OpenCode (${taskWithContext.length} chars)...`);
        const result = await client.executeTask(taskWithContext);
        console.log(`[opencode_task] Result: success=${result.success}, sessionId=${result.sessionId}, summary=${result.summary.length} chars, diff=${result.diff?.files?.length ?? 0} files`);

        if (!result.success) {
          console.warn(`[opencode_task] Task failed: ${result.summary.slice(0, 500)}`);
          return `OpenCode task failed: ${result.summary}`;
        }

        // Build human-readable summary
        const lines: string[] = [];
        lines.push("OpenCode task completed successfully.");
        lines.push("");
        lines.push("**Summary:**");
        lines.push(
          result.summary.length > 2000
            ? result.summary.slice(0, 2000) + "\n[truncated]"
            : result.summary,
        );

        if (result.diff?.files && result.diff.files.length > 0) {
          lines.push("");
          lines.push("**Files modified:**");
          for (const file of result.diff.files) {
            const adds = file.additions > 0 ? `+${file.additions}` : "";
            const dels = file.deletions > 0 ? `-${file.deletions}` : "";
            const stats = [adds, dels].filter(Boolean).join(", ");
            lines.push(`  - ${file.path}${stats ? ` (${stats})` : ""}`);
          }
          lines.push(
            `\nTotal: ${result.diff.files.length} file(s) changed`,
          );
        } else {
          lines.push("\nNo file changes detected.");
        }

        return lines.join("\n");
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : String(err);

        // Provide actionable error messages
        if (
          message.includes("ECONNREFUSED") ||
          message.includes("fetch failed")
        ) {
          return `OpenCode server not running at ${apiUrl}. Start it with: opencode serve`;
        }
        if (message.includes("401") || message.includes("403")) {
          return `OpenCode authentication failed. Check credentials in Settings > OpenCode.`;
        }

        return `OpenCode error: ${message}`;
      }
    },
  });
}
