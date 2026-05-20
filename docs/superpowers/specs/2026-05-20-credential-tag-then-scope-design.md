# Credential tag-then-scope — design

## Context

`runAgentShell` currently bulk-injects every credential in `ctx.secrets` (agent credentials *plus* global provider keys) into the sandboxed shell env. A prompt-injected agent with `canRunShell: true` can `env` and exfiltrate everything. Direct integrations (`github.ts`, `email.ts`, `slack-connector.ts`) already consume credentials structurally and aren't part of this risk surface. This design narrows the shell-env exposure to credentials the user has explicitly scoped to the active context.

## Data model

One new column on `agent_secrets`:

```ts
export const agentSecrets = sqliteTable("agent_secrets", {
  agentId: text("agent_id").notNull(),
  key:     text("key").notNull(),
  value:   text("value").notNull(),
  scope:   text("scope").notNull().default("broad"),
});
```

`scope` grammar:
- `"direct"` — never in shell env; only reachable via `ctx.secrets.get(key)` from direct integrations.
- `"cap:<id>"` or `"cap:<id1>,<id2>"` — injected into shell env only when at least one listed capability is currently enabled on the agent.
- `"broad"` — injected into every shell exec. UI flags with warning chip.

Provider keys (merged from `getProviderSecretsForProfile`) get implicit `direct` scope at orchestrator-start time. They never live in `agent_secrets` and never enter the shell.

One new field on capability metadata:

```ts
export interface SkillMeta {
  …
  /** Env-var names this capability looks for. UI hint only — not enforced. */
  credentialKeys?: string[];
}
```

## Data flow at exec time

`AgentContext.secrets: Map<string, string>` stays unchanged for direct integrations. A new thunk does the filtering:

```ts
export interface AgentContext {
  profile: AgentProfile;
  secrets: Map<string, string>;
  shellSecrets: () => Map<string, string>;   // ← new
  …
}
```

Thunk (re-evaluated per `shell_exec` so capability toggles take effect live):

```ts
function buildShellSecrets(
  scoped: Map<string, { value: string; scope: string }>,
  enabledCapIds: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, { value, scope }] of scoped) {
    if (scope === "direct") continue;
    if (scope === "broad") { out.set(key, value); continue; }
    if (scope.startsWith("cap:")) {
      const ids = scope.slice(4).split(",");
      if (ids.some((id) => enabledCapIds.has(id))) out.set(key, value);
    }
  }
  return out;
}
```

Only two consumer changes: `shell_exec` and `term:open` call `ctx.shellSecrets()` instead of `ctx.secrets`. `shell.ts` itself is unchanged. The `^[A-Za-z_][A-Za-z0-9_]*$` env-name regex stays as defense in depth.

## Built-in catalog updates

In `packages/server/src/skills/builtin-catalog.ts`:

- Extend `gh-auth` with `credentialKeys: ["GITHUB_TOKEN"]`.
- Add a new `email` capability declaring `credentialKeys: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]` and granting the existing `send_email` tool. Its credentials migrate to `direct` (consumed by `email.ts`, not shell) — the `credentialKeys` list is a UI hint.
- `provider-clis` capability for shell-side use of `claude` / `openai` CLIs: **deferred**, not part of this rollout.

Slack / Discord need no catalog change; their tokens migrate to `direct`.

## API changes

`PATCH /api/agents/:id/credentials` accepts both legacy and structured body:

```ts
body: Record<string, string | { value: string; scope?: string }>
```

Legacy strings → `scope: "broad"` (server logs a one-line deprecation warning).

`GET /api/agents/:id/credentials` returns structured rows (breaking shape; only the Studio tab consumes it):

```ts
{ keys: [ { key: "GITHUB_TOKEN", scope: "cap:gh-auth" }, … ] }
```

New endpoint for scope-only edits (avoids re-sending the secret):

```ts
PATCH /api/agents/:id/credentials/:key/scope
body: { scope: string }
```

## UI

Credentials tab `AgentStudio.tsx`:
- Add-credential form grows a Scope radio group: Direct / Bound to capability (multi-select dropdown) / Broad shell (with warning chip).
- Typing a known key (e.g., `GITHUB_TOKEN`) auto-suggests the matching capability from `credentialKeys`.
- Each existing row gets a scope badge (accent for `cap:*`, warning for `broad`, neutral for `direct`) and a `…` menu to edit scope only.

## Migration

One-time pass on startup. Per agent, per credential:

| Existing key (case-insensitive) | New scope |
|---|---|
| `GITHUB_TOKEN`, `GH_TOKEN` | `cap:gh-auth` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `direct` |
| `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` | `direct` |
| `DISCORD_BOT_TOKEN` | `direct` |
| anything else | `broad` |

Log a summary report: count of credentials per scope per agent, with explicit callout of any remaining `broad`.

## Error handling / edge cases

- Credential tagged `cap:gh-auth` but the capability is disabled or uninstalled → silently not injected. UI shows the chip with a muted state (`cap:gh-auth · disabled`).
- Credential tagged `cap:<unknown-id>` → behaves as if disabled. UI shows `cap:<id> · not installed`.
- A capability's `credentialKeys` does not change injection logic — it's purely a UI/discovery hint.
- The existing env-name regex (`^[A-Za-z_][A-Za-z0-9_]*$`) stays in `buildEnv`. Anything that gets past `shellSecrets()` still has to be a valid POSIX env-var name.

## Testing

- Unit tests for `buildShellSecrets`: every scope kind × enabled/disabled capabilities × multi-cap entries.
- Migration test: seed a control DB with legacy `{agentId, key, value}` rows, run migration, assert correct scopes per the pattern map.
- Integration test: build a runtime, request `shell_exec env`, assert presence/absence of each credential under various scope/capability states.
- Regression test: provider keys never appear in `shellSecrets()` output regardless of agent config.
