import { tool } from "ai";
import { z } from "zod";
import { execSync } from "node:child_process";
import type { ToolContext } from "./tool-context.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT_SIZE = 50_000; // 50KB — trim output to fit LLM context

export function createShellExecTool(ctx: ToolContext) {
  return tool({
    description:
      "Execute a shell command in your workspace directory. " +
      "The working directory is set to your workspace. " +
      "Commands have a 30-second timeout by default (max 120s). " +
      "Output is capped at 50KB.",
    parameters: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .optional()
        .describe(
          "Timeout in milliseconds (default: 30000, max: 120000)",
        ),
    }),
    execute: async ({ command, timeout }) => {
      const effectiveTimeout = Math.min(
        timeout ?? DEFAULT_TIMEOUT,
        MAX_TIMEOUT,
      );

      try {
        const output = execSync(command, {
          cwd: ctx.workspacePath,
          timeout: effectiveTimeout,
          stdio: "pipe",
          maxBuffer: 1024 * 1024, // 1MB buffer
          env: {
            ...process.env,
            HOME: ctx.workspacePath,
          },
        });
        const text = output.toString();
        if (text.length > MAX_OUTPUT_SIZE) {
          return (
            text.slice(0, MAX_OUTPUT_SIZE) +
            `\n\n[Output truncated at ${MAX_OUTPUT_SIZE} bytes. Total: ${text.length} bytes]`
          );
        }
        return text || "(no output)";
      } catch (err: unknown) {
        // execSync throws on non-zero exit codes
        const execErr = err as {
          status?: number;
          stdout?: Buffer;
          stderr?: Buffer;
          message?: string;
        };
        const stderr = execErr.stderr?.toString() ?? "";
        const stdout = execErr.stdout?.toString() ?? "";
        const combined = `Exit code: ${execErr.status ?? "unknown"}\nstdout: ${stdout}\nstderr: ${stderr}`;
        if (combined.length > MAX_OUTPUT_SIZE) {
          return combined.slice(0, MAX_OUTPUT_SIZE) + "\n[truncated]";
        }
        return combined;
      }
    },
  });
}
