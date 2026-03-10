/**
 * Sanitise user-controlled configuration values before embedding them in
 * LLM prompts.  Strips control characters (newlines, tabs, etc.) and caps
 * the length to prevent prompt-injection attacks.
 */
export function sanitizeForPrompt(value: string, maxLength = 200): string {
  // Strip control characters (newlines, carriage returns, tabs, etc.)
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "");
  return cleaned.slice(0, maxLength);
}

/**
 * Validate that a fork repository string matches the expected `owner/repo`
 * format and contains only safe characters.  Returns the validated string
 * or `null` if it is invalid.
 */
const FORK_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function validateForkRepo(value: string): string | null {
  if (!FORK_REPO_RE.test(value)) return null;
  return value;
}

/**
 * Extract the owner portion from a validated `owner/repo` string.
 * Returns `null` when the value is not a valid fork repo.
 */
export function extractForkOwner(forkRepo: string): string | null {
  const validated = validateForkRepo(forkRepo);
  if (!validated) return null;
  return validated.split("/")[0];
}
