import type { CredentialScope } from "@otterbot/shared";
import type { ScopedSecret } from "./secrets-store.js";

/**
 * Filter a scoped credential map down to the subset that should appear in
 * the agent's shell env for a given set of currently-enabled capabilities.
 *
 * - `direct`-scoped credentials are never returned (they live behind
 *   structured integrations like `github.ts` / `email.ts`).
 * - `broad`-scoped credentials always pass through.
 * - `cap:<id>(,<id>…)`-scoped credentials pass through only when at least
 *   one of the listed capability ids is in `enabledCapabilityIds`.
 *
 * Idempotent and side-effect-free. Called per `shell_exec` so capability
 * enable/disable takes effect live.
 */
export function buildShellSecrets(
  scoped: Map<string, ScopedSecret>,
  enabledCapabilityIds: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, { value, scope }] of scoped) {
    if (allowsShell(scope, enabledCapabilityIds)) out.set(key, value);
  }
  return out;
}

/** Whether a single scope string permits shell-env exposure right now. */
export function allowsShell(
  scope: CredentialScope,
  enabledCapabilityIds: Set<string>,
): boolean {
  if (scope === "direct") return false;
  if (scope === "broad") return true;
  if (scope.startsWith("cap:")) {
    const ids = scope.slice(4).split(",").map((s) => s.trim()).filter(Boolean);
    return ids.some((id) => enabledCapabilityIds.has(id));
  }
  // Unrecognised scope string: deny by default.
  return false;
}

/**
 * Match a raw env-var key against a built-in pattern map to suggest a
 * scope at migration time. Returns the suggested scope, or `"broad"` if
 * the key isn't recognised.
 */
export function suggestScopeForKey(key: string): CredentialScope {
  const upper = key.trim().toUpperCase();
  if (upper === "GITHUB_TOKEN" || upper === "GH_TOKEN") return "cap:gh-auth";
  if (upper.startsWith("SMTP_")) return "direct";
  if (upper === "SLACK_BOT_TOKEN" || upper === "SLACK_APP_TOKEN") return "direct";
  if (upper === "DISCORD_BOT_TOKEN") return "direct";
  return "broad";
}
