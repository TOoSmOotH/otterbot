import { tool } from "ai";
import { z } from "zod";
import { execSync } from "node:child_process";
import type { ToolContext } from "./tool-context.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT_SIZE = 50_000; // 50KB — trim output to fit LLM context

// Port 3000 is reserved for the Smoothbot server — workers must not bind to it
const RESERVED_PORT = parseInt(process.env.PORT ?? "3000", 10);

const BLOCKED_COMMANDS: { pattern: RegExp; reason: string; suggestion?: string }[] = [
  { pattern: /\bpkill\b/, reason: "pkill matches processes by name across the whole system and can kill the host", suggestion: "Use `kill <pid>` with a specific PID" },
  { pattern: /\bkillall\b/, reason: "killall matches processes by name across the whole system and can kill the host", suggestion: "Use `kill <pid>` with a specific PID" },
  { pattern: /\bshutdown\b/, reason: "System shutdown is not permitted" },
  { pattern: /\breboot\b/, reason: "System reboot is not permitted" },
  { pattern: /\bhalt\b/, reason: "System halt is not permitted" },
  { pattern: /\bpoweroff\b/, reason: "System poweroff is not permitted" },
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/, reason: "rm targeting root filesystem paths is not permitted", suggestion: "Only delete files within your workspace" },
  { pattern: /\bmkfs\b/, reason: "Formatting filesystems is not permitted" },
  { pattern: /\bdd\b.*\bof=\/dev\//, reason: "Raw disk writes are not permitted" },
];

function checkBlockedCommand(command: string): string | null {
  for (const { pattern, reason, suggestion } of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      const parts = [`BLOCKED: ${reason}.`];
      if (suggestion) parts.push(`${suggestion}.`);
      parts.push("Use a more targeted command instead.");
      return parts.join(" ");
    }
  }

  // Block commands that try to listen on the reserved Smoothbot server port
  const portStr = String(RESERVED_PORT);
  const portPattern = new RegExp(`(?:--|:|=|\\s)${portStr}(?:\\s|$|"|\\')`);
  if (portPattern.test(command)) {
    return `BLOCKED: Port ${portStr} is reserved for the Smoothbot server. Use a different port (e.g. 4000, 5000, 8080).`;
  }

  return null;
}

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
      const blocked = checkBlockedCommand(command);
      if (blocked) {
        console.warn(`[shell-exec] Blocked command: ${command}`);
        return blocked;
      }

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
