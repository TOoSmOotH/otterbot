import { basename } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Commands allowed for stdio MCP servers */
const ALLOWED_COMMANDS = new Set([
  "npx",
  "node",
  "python",
  "python3",
  "uvx",
  "docker",
  "deno",
]);

/** Patterns blocked in command arguments */
const BLOCKED_ARG_PATTERNS = [
  /\brm\b/,
  /\bdd\b/,
  /\bmkfs\b/,
  /\bshutdown\b/,
  /\bcurl\b/,
  /\bwget\b/,
  /\bnc\b/,
  /\bssh\b/,
  /\bchmod\b/,
  /\bchown\b/,
];

/** Environment variables that must never be passed to MCP processes */
const BLOCKED_ENV_VARS = new Set([
  "OTTERBOT_DB_KEY",
  "DATABASE_URL",
  "OTTERBOT_PASSPHRASE",
  "SESSION_SECRET",
]);

/** Environment variables safe to inherit from host */
const SAFE_INHERITED_VARS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "TZ",
  "TERM",
  "NODE_ENV",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

/** RFC 1918 and other internal network patterns */
const INTERNAL_NETWORK_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^0\./,
  /^\[::1\]/,
  /^\[fc/i,
  /^\[fd/i,
  /^\[fe80:/i,
];

export interface SecurityWarning {
  type: "no-version-pin" | "non-https" | "secret-env" | "broad-tools";
  message: string;
}

export interface CommandValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a command for stdio transport.
 * Only allows commands from the allowlist.
 */
export function validateCommand(command: string): CommandValidationResult {
  const base = basename(command);
  if (!ALLOWED_COMMANDS.has(base)) {
    return {
      valid: false,
      error: `Command "${base}" is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Validate command arguments for dangerous patterns.
 */
export function validateArgs(args: string[]): CommandValidationResult {
  for (const arg of args) {
    for (const pattern of BLOCKED_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return {
          valid: false,
          error: `Argument "${arg}" contains blocked pattern "${pattern.source}"`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Filter environment variables for MCP process.
 * Removes blocked vars, adds safe inherited vars, then applies user-defined vars.
 */
export function filterEnvVars(userEnv: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  // Add safe inherited vars from host
  for (const key of SAFE_INHERITED_VARS) {
    if (process.env[key]) {
      result[key] = process.env[key]!;
    }
  }

  // Add user-defined vars, filtering out blocked ones
  for (const [key, value] of Object.entries(userEnv)) {
    if (!BLOCKED_ENV_VARS.has(key)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Get the isolated working directory for an MCP server process.
 */
export function getIsolatedWorkDir(serverId: string): string {
  return join(tmpdir(), "otterbot-mcp", serverId);
}

/**
 * Validate an SSE URL for security.
 * Requires HTTPS for non-localhost URLs.
 * Blocks internal network addresses.
 */
export function validateSseUrl(url: string): CommandValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "Invalid URL" };
  }

  const hostname = parsed.hostname;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  // Require HTTPS for non-localhost
  if (!isLocalhost && parsed.protocol !== "https:") {
    return {
      valid: false,
      error: "HTTPS is required for non-localhost MCP server URLs",
    };
  }

  // Block internal network addresses (except localhost)
  if (!isLocalhost) {
    for (const pattern of INTERNAL_NETWORK_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          valid: false,
          error: `Internal network addresses are not allowed: ${hostname}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Generate security warnings for a server configuration.
 * Warnings are advisory, not blocking.
 */
export function getSecurityWarnings(config: {
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  allowedTools?: string[] | null;
}): SecurityWarning[] {
  const warnings: SecurityWarning[] = [];

  if (config.transport === "stdio") {
    // Check for npx without version pin
    if (config.command && basename(config.command) === "npx") {
      const args = config.args ?? [];
      const packageArg = args.find((a) => !a.startsWith("-"));
      if (packageArg && !packageArg.includes("@")) {
        warnings.push({
          type: "no-version-pin",
          message: `Package "${packageArg}" has no version pin. Consider using "${packageArg}@latest" or a specific version.`,
        });
      }
    }
  }

  if (config.transport === "sse" && config.url) {
    try {
      const parsed = new URL(config.url);
      const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (isLocalhost && parsed.protocol !== "https:") {
        warnings.push({
          type: "non-https",
          message: "Using HTTP for localhost connection. HTTPS is recommended for production use.",
        });
      }
    } catch {
      // URL validation handled separately
    }
  }

  // Check for secret-looking env vars
  const secretPattern = /passw|secret|token|key|auth/i;
  if (config.env) {
    for (const key of Object.keys(config.env)) {
      if (secretPattern.test(key)) {
        warnings.push({
          type: "secret-env",
          message: `Environment variable "${key}" appears to contain a secret. It will be stored encrypted in the database.`,
        });
      }
    }
  }

  // Check for broad tool permissions
  if (config.allowedTools === null) {
    warnings.push({
      type: "broad-tools",
      message: "All tools from this server are allowed. Consider restricting to specific tools.",
    });
  }

  return warnings;
}
