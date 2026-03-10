import { resolve, normalize } from "node:path";
import { execSync } from "node:child_process";

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
  // Privilege escalation & system administration
  { pattern: /\bsudo\b/, reason: "Privilege escalation is not permitted" },
  { pattern: /\bchmod\b/, reason: "Changing file permissions is not permitted" },
  { pattern: /\bsystemctl\b/, reason: "Managing system services is not permitted" },
  { pattern: /\bpasswd\b/, reason: "Changing passwords is not permitted" },
  { pattern: /\buseradd\b/, reason: "User account management is not permitted" },
  { pattern: /\buserdel\b/, reason: "User account management is not permitted" },
  { pattern: /\busermod\b/, reason: "User account management is not permitted" },
  { pattern: /\biptables\b/, reason: "Firewall modification is not permitted" },
  { pattern: /\bufw\b/, reason: "Firewall modification is not permitted" },
  { pattern: /\bmodprobe\b/, reason: "Kernel module loading is not permitted" },
  { pattern: /\binsmod\b/, reason: "Kernel module loading is not permitted" },
  { pattern: /\brmmod\b/, reason: "Kernel module removal is not permitted" },
  // Git remote manipulation — workers must not modify remotes
  { pattern: /\bgit\s+remote\s+(?:add|set-url|rename|remove|rm)\b/, reason: "Modifying git remotes is not permitted", suggestion: "Use the pre-configured origin remote" },
];

/**
 * Normalize a command string to defeat simple obfuscation:
 * - Strip backslash-escapes (e.g., \c\u\r\l → curl)
 * - Extract basenames from absolute paths (e.g., /usr/bin/curl → curl)
 */
export function normalizeCommand(command: string): string {
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
  return command.split(/\s*(?:\|{1,2}|&&|;)\s*/);
}

/**
 * Check whether a command matches any blocked pattern.
 * Returns a human-readable block message, or null if the command is allowed.
 */
export function checkBlockedCommand(command: string): string | null {
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

  return null;
}

/** Allowed remotes for git push commands */
const ALLOWED_PUSH_REMOTES = new Set(["origin", "upstream"]);

/**
 * Check if a git push targets an allowed remote.
 * Blocks pushes to arbitrary remotes or explicit URLs.
 * Returns a block message, or null if allowed.
 */
export function checkGitPushTarget(command: string): string | null {
  // Check against both raw and normalized command to catch URLs before normalization mangles them
  const segments = splitCommandSegments(command);
  const normalizedSegments = splitCommandSegments(normalizeCommand(command));

  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i].trim();
    const normalized = normalizedSegments[i]?.trim() ?? raw;
    if (!normalized) continue;

    // Match `git push <remote>` — remote is the first non-flag argument after `push`
    const pushMatch = normalized.match(/\bgit\s+push\s+(.+)/);
    if (!pushMatch) continue;

    // Also check the raw segment for URL patterns (normalization strips path components)
    if (/\bgit\s+push\s+.*(?:\/\/|@)/.test(raw)) {
      return `BLOCKED: Pushing to explicit URLs is not permitted. Use the pre-configured origin remote.`;
    }

    // Parse arguments after `push` to find the remote
    const args = pushMatch[1].split(/\s+/);
    for (const arg of args) {
      // Skip flags
      if (arg.startsWith("-")) continue;

      // Check for URL patterns that survived normalization
      if (arg.includes("://") || arg.includes("@")) {
        return `BLOCKED: Pushing to explicit URLs is not permitted. Use the pre-configured origin remote.`;
      }
      if (!ALLOWED_PUSH_REMOTES.has(arg)) {
        return `BLOCKED: Pushing to remote '${arg}' is not permitted. Only 'origin' and 'upstream' are allowed.`;
      }
      // Found a valid remote, stop checking this segment
      break;
    }
  }

  return null;
}

/** System paths that are always safe to reference in commands */
const SAFE_SYSTEM_PATHS = [
  "/usr", "/bin", "/sbin", "/lib", "/lib64",
  "/tmp", "/dev/null", "/dev/zero", "/dev/urandom", "/dev/stdin", "/dev/stdout", "/dev/stderr",
  "/etc/os-release", "/etc/hostname", "/etc/resolv.conf",
  "/proc/", "/sys/",
];

/**
 * Check if a command references paths outside the allowed workspace boundary.
 * Returns a block message if cross-project paths are detected, or null if safe.
 */
export function checkWorkspaceBoundary(command: string, workspacePath: string, workspaceRoot: string): string | null {
  // Extract absolute paths from the command
  const pathMatches = command.match(/(?:^|\s)(\/[\w.\/-]+)/g);
  if (!pathMatches) return null;

  const normalizedWorkspace = normalize(resolve(workspacePath));
  const normalizedRoot = normalize(resolve(workspaceRoot));

  for (const match of pathMatches) {
    const absPath = normalize(resolve(match.trim()));

    // Allow paths within the current workspace
    if (absPath.startsWith(normalizedWorkspace)) continue;

    // Allow safe system paths
    if (SAFE_SYSTEM_PATHS.some((safe) => absPath.startsWith(safe))) continue;

    // Check for cross-project access (paths under workspace root but not current workspace)
    const projectsDir = normalize(resolve(workspaceRoot, "projects"));
    if (absPath.startsWith(projectsDir) && !absPath.startsWith(normalizedWorkspace)) {
      return `BLOCKED: Cross-project path access detected (${absPath}). You may only access files within your workspace: ${workspacePath}`;
    }

    // Also block paths that land in sibling project directories under the workspace root
    if (absPath.startsWith(normalizedRoot) && !absPath.startsWith(normalizedWorkspace)) {
      return `BLOCKED: Path ${absPath} is outside your workspace boundary. You may only access files within: ${workspacePath}`;
    }
  }

  return null;
}

/**
 * Audit git remotes in a worktree. Returns unexpected remote names, or empty array if clean.
 */
export function auditGitRemotes(worktreePath: string): string[] {
  try {
    const output = execSync("git remote", {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!output) return [];

    const remotes = output.split("\n").map((r: string) => r.trim()).filter(Boolean);
    return remotes.filter((r: string) => !ALLOWED_PUSH_REMOTES.has(r));
  } catch {
    return [];
  }
}
