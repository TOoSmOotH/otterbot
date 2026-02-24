import { tool } from "ai";
import { z } from "zod";
import { execSync } from "node:child_process";
import type { ToolContext } from "./tool-context.js";
import { getConfig } from "../auth/auth.js";

const DEFAULT_TIMEOUT = 30_000; // 30 seconds
const MAX_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT_SIZE = 50_000; // 50KB — trim output to fit LLM context

// Port 62626 is reserved for the Otterbot server — workers must not bind to it
const RESERVED_PORT = parseInt(process.env.PORT ?? "62626", 10);

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
  { pattern: /\bcurl\b/, reason: "curl can exfiltrate data or fetch malicious payloads", suggestion: "Use the web_browse tool to fetch web content" },
  { pattern: /\bwget\b/, reason: "wget can exfiltrate data or fetch malicious payloads", suggestion: "Use the web_browse tool to fetch web content" },
  { pattern: /\b(?:nc|ncat|netcat)\b/, reason: "Netcat can open arbitrary network connections", suggestion: "Use higher-level tools for network operations" },
  { pattern: /\bsocat\b/, reason: "socat can open arbitrary network connections", suggestion: "Use higher-level tools for network operations" },
  { pattern: /\bssh\b/, reason: "ssh can open remote connections", suggestion: "Use higher-level tools for remote operations" },
  { pattern: /\bscp\b/, reason: "scp can transfer files to/from remote hosts", suggestion: "Use higher-level tools for file transfers" },
  { pattern: /\btelnet\b/, reason: "telnet can open arbitrary network connections", suggestion: "Use higher-level tools for network operations" },
  { pattern: /\bcrontab\b/, reason: "crontab can schedule persistent tasks on the host", suggestion: "Use the scheduler tool for scheduled tasks" },
  { pattern: /\bchown\b/, reason: "chown can change file ownership and compromise security boundaries" },
];

/**
 * Normalize a command string to defeat simple obfuscation:
 * - Strip backslash-escapes (e.g., \c\u\r\l → curl)
 * - Extract basenames from absolute paths (e.g., /usr/bin/curl → curl)
 */
function normalizeCommand(command: string): string {
  // Remove backslash escapes within words (e.g., cu\rl → curl)
  let normalized = command.replace(/\\(.)/g, "$1");
  // Extract basenames from absolute paths (e.g., /usr/bin/curl → curl)
  normalized = normalized.replace(/(?:\/[\w.-]+)+\/([\w.-]+)/g, "$1");
  return normalized;
}

/**
 * Split a command string on shell operators (|, &&, ||, ;) to check each segment.
 */
function splitCommandSegments(command: string): string[] {
  // Split on pipe, &&, ||, ; — but not inside quotes
  // Simple approach: split on unquoted operators
  return command.split(/\s*(?:\|{1,2}|&&|;)\s*/);
}

function checkBlockedCommand(command: string): string | null {
  const normalized = normalizeCommand(command);
  const segments = splitCommandSegments(normalized);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    for (const { pattern, reason, suggestion } of BLOCKED_COMMANDS) {
      if (pattern.test(trimmed)) {
        const parts = [`BLOCKED: ${reason}.`];
        if (suggestion) parts.push(`${suggestion}.`);
        parts.push("Use a more targeted command instead.");
        return parts.join(" ");
      }
    }
  }

  // Block commands that try to listen on the reserved Otterbot server port
  const portStr = String(RESERVED_PORT);
  const portPattern = new RegExp(`(?:--|:|=|\\s)${portStr}(?:\\s|$|"|\\')`);
  if (portPattern.test(normalized)) {
    return `BLOCKED: Port ${portStr} is reserved for the Otterbot server. Use a different port (e.g. 4000, 5000, 8080).`;
  }

  return null;
}

const RECOVERY_HINTS: { pattern: RegExp; hint: string }[] = [
  {
    pattern: /: not found|command not found|No such file or directory.*bin\//i,
    hint: "A command was not found. If this is a project dependency (e.g. vite, tsc, jest, eslint), " +
      "you probably need to install dependencies first: run `npm install` (or `yarn install` / `pnpm install`) " +
      "in the project directory, then retry. For globally-needed tools, install them with `npm install -g <package>`.",
  },
  {
    pattern: /Cannot find module|MODULE_NOT_FOUND|Error: Cannot find package/i,
    hint: "A Node.js module was not found. Run `npm install` in the project directory to install dependencies, then retry.",
  },
  {
    pattern: /ModuleNotFoundError|No module named/i,
    hint: "A Python module was not found. Run `pip install -r requirements.txt` (or `pip install <package>`) then retry.",
  },
  {
    pattern: /EADDRINUSE|address already in use/i,
    hint: "The port is already in use. Either kill the existing process (`lsof -ti:<port> | xargs kill`) or use a different port.",
  },
  {
    pattern: /EACCES|permission denied/i,
    hint: "Permission denied. Avoid writing to system paths — use your workspace directory instead.",
  },
];

function getRecoveryHint(output: string): string | null {
  for (const { pattern, hint } of RECOVERY_HINTS) {
    if (pattern.test(output)) return hint;
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
            ...(() => {
              const ghToken = getConfig("github:token");
              return ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {};
            })(),
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
        let combined = `Exit code: ${execErr.status ?? "unknown"}\nstdout: ${stdout}\nstderr: ${stderr}`;

        // Append recovery hints for common errors so the LLM can self-correct
        const hint = getRecoveryHint(stderr + stdout);
        if (hint) {
          combined += `\n\n[HINT] ${hint}`;
        }

        if (combined.length > MAX_OUTPUT_SIZE) {
          return combined.slice(0, MAX_OUTPUT_SIZE) + "\n[truncated]";
        }
        return combined;
      }
    },
  });
}
