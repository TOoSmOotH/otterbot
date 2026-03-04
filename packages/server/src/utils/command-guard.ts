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
