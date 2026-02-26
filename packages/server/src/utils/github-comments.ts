/**
 * Consistent markdown formatting helpers for GitHub issue/PR comments.
 */

/**
 * Format a standard bot comment with a heading and optional body.
 *
 * @example
 * formatBotComment("Pipeline Started", "Stages: `coder` → `security`")
 * // ### Pipeline Started\n\nStages: `coder` → `security`
 */
export function formatBotComment(title: string, body?: string): string {
  if (body) {
    return `### ${title}\n\n${body}`;
  }
  return `### ${title}`;
}

/**
 * Format a comment with a collapsible `<details>` section for lengthy content.
 *
 * @param title    - Heading text (rendered as `### title`)
 * @param summary  - Content shown above the fold
 * @param details  - Content placed inside a collapsible `<details>` block
 *
 * @example
 * formatBotCommentWithDetails(
 *   "Implementation Complete",
 *   "PR created: #123",
 *   cleanedTerminalOutput,
 * )
 */
export function formatBotCommentWithDetails(
  title: string,
  summary: string,
  details: string,
): string {
  // Wrap details in a code block to preserve formatting and prevent
  // raw terminal output from being interpreted as broken markdown
  const wrappedDetails = "```\n" + details + "\n```";
  return [
    `### ${title}`,
    "",
    summary,
    "",
    "<details>",
    "<summary>Details</summary>",
    "",
    wrappedDetails,
    "",
    "</details>",
  ].join("\n");
}
