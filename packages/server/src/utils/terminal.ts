/**
 * Shared terminal output cleaning utilities.
 *
 * Provides comprehensive ANSI stripping, terminal artifact removal,
 * PTY buffer summarisation, and LLM-powered summarisation for use
 * across the codebase.
 */

/* eslint-disable no-control-regex */

import { generateText } from "ai";
import { getConfig } from "../auth/auth.js";
import { resolveModel } from "../llm/adapter.js";

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

/**
 * Lighter-touch terminal cleaning that does NOT simulate CR overwrites.
 *
 * TUI-based tools (Claude Code, OpenCode, etc.) use \r to redraw their
 * interface lines — not to overwrite progress bars.  When the TUI exits,
 * the CR simulation in {@link cleanTerminalOutput} reduces the buffer to
 * the final (empty) screen state, losing all useful content.
 *
 * This variant strips ANSI codes, spinner glyphs, and collapses blank
 * lines, but preserves every line segment (including those before \r).
 */
export function cleanTerminalOutputNoCR(input: string): string {
  let text = stripAnsi(input);

  // Replace \r with \n so every segment becomes its own line
  text = text.replace(/\r/g, "\n");

  // Remove spinner / decorative glyphs
  text = text.replace(SPINNER_GLYPHS_RE, "");

  // Collapse multiple consecutive blank lines into one
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** GitHub PR URL pattern */
const PR_URL_RE = /https:\/\/github\.com\/[^\s]+\/pull\/\d+/g;

/**
 * Minimum length (in chars) for the cleaned output to be considered
 * substantive.  Below this threshold the two-pass fallback kicks in.
 */
const MIN_CLEAN_LENGTH = 50;

/**
 * Build a summary from a PTY ring-buffer suitable for a completion report.
 *
 * - First pass: cleans via {@link cleanTerminalOutput} (CR simulation)
 * - Fallback: if the first pass yields very little content but the raw
 *   buffer is substantial, re-cleans via {@link cleanTerminalOutputNoCR}
 *   so TUI-based tool output (code reviews, etc.) is preserved.
 * - Extracts any GitHub PR URLs
 * - Appends a cleaned tail (max `tailChars`) only if non-empty
 */
export function extractPtySummary(
  ringBuffer: string,
  tailChars = 6000,
): string {
  let clean = cleanTerminalOutput(ringBuffer);

  // Two-pass fallback: if CR simulation destroyed useful content, retry
  // without CR processing so TUI output (reviews, analyses) survives.
  if (clean.length < MIN_CLEAN_LENGTH && ringBuffer.length >= MIN_CLEAN_LENGTH) {
    clean = cleanTerminalOutputNoCR(ringBuffer);
  }

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

// ─── LLM-powered summarisation ──────────────────────────────────

const STAGE_HINTS: Record<string, string> = {
  coder:
    "Summarize what was implemented or changed. Mention any PRs created. " +
    "Focus on the files modified and the purpose of the changes.",
  security:
    "List security findings as bullet points with severity (critical/high/medium/low). " +
    "If no issues were found, state that clearly.",
  tester:
    "Summarize test results: pass/fail counts, list any failures with the test name and a brief reason.",
  reviewer:
    "Summarize the review verdict (approve / request changes) and list key feedback points.",
  "review-feedback":
    "Summarize what review feedback was addressed and what changes were made in response.",
};

const SUMMARIZE_SYSTEM_PROMPT = `You summarize terminal output from a CI/CD pipeline stage for a GitHub comment.
Output clean, concise GitHub-flavored markdown. Do NOT wrap in a code block.
Keep it short — ideally under 15 lines. Omit ANSI artifacts, spinner characters, and noise.`;

/**
 * Use a lightweight LLM to produce a clean markdown summary of terminal output.
 *
 * Returns `null` on any error or if the input is too short to be worth summarizing,
 * so callers can gracefully fall back to raw output.
 */
export async function summarizeForGitHub(
  cleanedOutput: string,
  stage: string,
): Promise<string | null> {
  if (cleanedOutput.length < 100) return null;

  try {
    const provider = getConfig("worker_provider") ?? "openai";
    const modelName = getConfig("worker_model") ?? "gpt-4o-mini";

    const model = resolveModel({ provider, model: modelName });

    const stageHint = STAGE_HINTS[stage] ?? `Summarize the output from the "${stage}" stage.`;

    const result = await generateText({
      model,
      system: `${SUMMARIZE_SYSTEM_PROMPT}\n\n${stageHint}`,
      prompt: cleanedOutput,
      maxTokens: 1024,
    });

    return result.text || null;
  } catch (err) {
    console.error(`[summarizeForGitHub] Failed to summarize ${stage} output:`, err);
    return null;
  }
}
