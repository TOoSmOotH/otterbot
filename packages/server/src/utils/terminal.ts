/**
 * Shared terminal output cleaning utilities.
 *
 * Provides comprehensive ANSI stripping, terminal artifact removal,
 * and PTY buffer summarisation for use across the codebase.
 */

/* eslint-disable no-control-regex */

/**
 * Comprehensive ANSI / terminal escape-sequence stripper.
 *
 * Handles:
 *  - CSI sequences  (ESC [ … final-byte)
 *  - OSC sequences  (ESC ] … BEL  or  ESC ] … ST)
 *  - DCS / PM / APC (ESC P / ^ / _ … ST)
 *  - Simple Fe escapes (ESC followed by a single byte 0x40-0x5F)
 *  - Standalone BEL, BS, DEL
 *  - Remaining C0/C1 control chars (except \n, \r, \t)
 */
const ANSI_RE = new RegExp(
  [
    // CSI sequences: ESC [ (params) (intermediates) final-byte
    "\\x1B\\[[0-?]*[ -/]*[@-~]",
    // OSC sequences: ESC ] … terminated by BEL or ST (ESC \\)
    "\\x1B\\][^\\x07\\x1B]*(?:\\x07|\\x1B\\\\)",
    // DCS / PM / APC: ESC P|^|_ … ST
    "\\x1B[P^_][^\\x1B]*\\x1B\\\\",
    // Fe escape: ESC + single byte 0x40-0x5F (covers SS2, SS3, etc.)
    "\\x1B[@-Z\\\\-_]",
    // Standalone BEL / BS / DEL
    "[\\x07\\x08\\x7F]",
    // Remaining C0 controls except \n (0A), \r (0D), \t (09)
    "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]",
  ].join("|"),
  "g",
);

/** Strip all ANSI / terminal escape sequences from `input`. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

/**
 * Spinner / progress glyphs that terminal UIs render but which add
 * noise when embedded in plain text (e.g. GitHub comments).
 *
 * Ranges:
 *  - Braille patterns  U+2800 – U+28FF  (⠋⠙⠹… used by ora / cli-spinners)
 *  - Box-drawing chars  U+2500 – U+257F
 *  - Block elements     U+2580 – U+259F
 *  - Geometric shapes   U+25A0 – U+25FF (◼ ● ◯ …)
 */
const SPINNER_GLYPHS_RE = /[\u2800-\u28FF\u2500-\u257F\u2580-\u259F\u25A0-\u25FF]/g;

/**
 * Clean terminal output for embedding in markdown / GitHub comments.
 *
 * 1. Strips all ANSI escape sequences
 * 2. Simulates carriage-return line overwrites (keeps only final segment)
 * 3. Removes common spinner / progress-bar Unicode glyphs
 * 4. Collapses runs of blank lines into a single blank line
 * 5. Trims leading / trailing whitespace
 */
export function cleanTerminalOutput(input: string): string {
  let text = stripAnsi(input);

  // Simulate CR overwrites: for each line, keep content after the last \r
  text = text
    .split("\n")
    .map((line) => {
      const idx = line.lastIndexOf("\r");
      return idx >= 0 ? line.slice(idx + 1) : line;
    })
    .join("\n");

  // Remove spinner / decorative glyphs
  text = text.replace(SPINNER_GLYPHS_RE, "");

  // Collapse multiple consecutive blank lines into one
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** GitHub PR URL pattern */
const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/g;

/**
 * Build a summary from a PTY ring-buffer suitable for a completion report.
 *
 * - Cleans the buffer via {@link cleanTerminalOutput}
 * - Extracts any GitHub PR URLs
 * - Appends a cleaned tail (max `tailChars`) only if non-empty
 */
export function extractPtySummary(
  ringBuffer: string,
  tailChars = 2000,
): string {
  const clean = cleanTerminalOutput(ringBuffer);

  // Extract PR URLs
  const prUrls = clean.match(PR_URL_RE);

  const parts: string[] = ["Task completed."];
  if (prUrls) {
    const unique = [...new Set(prUrls)];
    for (const url of unique) {
      parts.push(`PR created: ${url}`);
    }
  }

  // Append cleaned tail only if it has substantive content
  const tail = clean.slice(-tailChars).trim();
  if (tail.length > 0) {
    parts.push("", `Terminal output (last ${tailChars} chars):\n${tail}`);
  }

  return parts.join("\n");
}
