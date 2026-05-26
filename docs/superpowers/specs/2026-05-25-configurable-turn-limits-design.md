# Configurable turn limits (browse timeout + step budget)

**Date:** 2026-05-25
**Status:** Approved — ready for implementation plan
**Scope:** B (turn controls). Out of scope: model-HTTP timeout, delegate/`bus.request` timeout.

## Problem

Long web turns produce empty replies in Matrix (and other chat channels). The
agent-facing symptom is a `"(no response)"` message that "looks like a timeout."

Investigation of the self-browse path found two distinct limits, only one of
which actually causes the empty reply:

- **Browse-tool timeout** — `integrations/browser.ts` runs each `agent-browser`
  subcommand with a hardcoded `DEFAULT_TIMEOUT_MS = 60_000`. On timeout it
  SIGKILLs the child and `toResult` returns `{ ok: false, error: "Browser
  command timed out." }` **to the model**, which then keeps going. So a browse
  timeout produces a model-visible error, *not* an empty reply.
- **Step budget** — `runtime/agent-runtime.ts` calls `streamText({ …, maxSteps:
  8 })`. A multi-step web task (open → snapshot → click → snapshot → …) can burn
  all 8 steps before the model writes its closing text. The turn then ends with
  empty `finalText`, which the channel connector renders as `"(no response)"`.
  Longer web usage consumes more steps, so it hits this more often — matching the
  reported symptom.

The connector itself awaits `runtime.respond()` with no timeout, confirming the
empty reply originates *inside* the turn, not in the transport.

## Goals

1. Make the browse-tool timeout and the model step budget configurable.
2. Resolve each as **env default → per-agent profile override** (null = inherit).
3. Replace the silent `"(no response)"` with a diagnostic message when the step
   budget is exhausted.
4. Preserve current behavior by default (8 steps, 60s browse). Users opt into
   longer limits; the only on-by-default change is the clearer message.

## Non-goals (Scope C, deferred)

- A per-call `abortSignal`/timeout on the model HTTP request (AI SDK / undici).
- Configurable delegate / `bus.request` timeout.
- A unified limits config object or dedicated limits UI panel.

## Design

### 1. Config defaults — `packages/server/src/config.ts`

Add two env-backed fields to `Config`, read in `loadConfig()`:

| Field | Env var | Default |
|---|---|---|
| `browseTimeoutMs` | `OTTERBOT_BROWSE_TIMEOUT_MS` | `60_000` |
| `agentMaxSteps` | `OTTERBOT_AGENT_MAX_STEPS` | `8` |

Parse as `Number(process.env.X ?? default)`, matching the existing
`subagentGraceMs` pattern. Document both in `.env.example`.

### 2. Per-agent overrides — `packages/shared/src/agent.ts`

Add two nullable fields to `AgentProfile` (`null` = inherit the env default):

```ts
/** Per-call browser command timeout (ms). null = inherit OTTERBOT_BROWSE_TIMEOUT_MS. */
browseTimeoutMs: number | null;
/** Max model steps (tool-call rounds) per turn. null = inherit OTTERBOT_AGENT_MAX_STEPS. */
maxSteps: number | null;
```

New profiles (and `buildSubagentProfile`) default both to `null`. Existing
profile.json files without these fields read as `null` (inherit) — no migration
required as long as the loader tolerates missing keys.

### 3. Resolution — `packages/server/src/runtime/agent-context.ts`

The orchestrator already resolves profile data into `AgentContext` (e.g.
`chatModelRef`). Resolve the effective limits the same way and bundle them as
plain numbers:

```ts
browseTimeoutMs: profile.browseTimeoutMs ?? cfg.browseTimeoutMs,
maxSteps: profile.maxSteps ?? cfg.agentMaxSteps,
```

`BuildAgentContextInput` gains the two config defaults (sourced from
`getConfig()` where the orchestrator builds the context). Tools and runtime then
read a single resolved number each — no null handling downstream, trivially
unit-testable.

### 4. Browse timeout threading — `integrations/browser.ts`, `agent/tools.ts`

- Add an optional `timeoutMs` to `BrowserEnv`.
- `browserEnvFor(agentId, profileDir, timeoutMs?)` stores it on the env.
- `runAgentBrowser` uses `env.timeoutMs ?? DEFAULT_TIMEOUT_MS`.
- `tools.ts` builds the env with the resolved value:
  `browserEnvFor(ctx.profile.id, ctx.browserProfileDir, ctx.browseTimeoutMs)`.

All exported `browserNavigate/Snapshot/Click/...` already pass `env`, so this is
a single new field rather than a per-function signature change. The teardown
call site (`closeBrowserSession(browserEnvFor(...))`) needs no timeout and may
omit the argument.

### 5. Step budget + empty-reply fix — `packages/server/src/runtime/agent-runtime.ts`

- Pass the resolved budget: `streamText({ …, maxSteps: this.ctx.maxSteps })`.
- After the stream completes, detect budget exhaustion: `finalText` is empty
  **and** the last entry of `await result.steps` has `finishReason ===
  "tool-calls"` (the model intended to continue but hit the cap). In that case
  set `finalText` to a clear, knob-naming message, e.g.:

  > "I hit my step budget (N steps) before finishing this task. Try narrowing
  > the request, or raise this agent's max steps."

  where `N = this.ctx.maxSteps`. This is distinct from the existing
  `!finalText && streamError` path (which throws the real error). It converts the
  silent `"(no response)"` into a diagnostic. The limit value itself is unchanged
  by default.

### 6. Per-agent UI — Agent Studio (`packages/web`)

Two optional number inputs (browse timeout ms, max steps) in the agent edit
form's advanced settings area. Empty input = `null` = inherit. Persisted through
the existing `PATCH /api/agents/:id`; no new endpoint. Placeholder text shows the
inherited default so the field reads as "override, currently inheriting N".

## Data flow

```
.env (OTTERBOT_BROWSE_TIMEOUT_MS / OTTERBOT_AGENT_MAX_STEPS)
        │  loadConfig()
        ▼
Config { browseTimeoutMs, agentMaxSteps }
        │  orchestrator builds context
        ▼
buildAgentContext(profile, cfg) ──► AgentContext { browseTimeoutMs, maxSteps }
        │                                   │
        │ browserEnvFor(id, dir, t)         │ streamText({ maxSteps })
        ▼                                   ▼
runAgentBrowser honors timeout      budget-exhaustion → diagnostic finalText
```

Profile override (`AgentProfile.browseTimeoutMs/maxSteps`) feeds into
`buildAgentContext` and takes precedence over the `Config` default; `null` falls
through to the default.

## Error handling

- Browse timeout: unchanged shape — model-visible `{ ok: false, error: "Browser
  command timed out." }`. Raising the limit lets slow pages finish.
- Step budget exhaustion: diagnostic `finalText` (above) instead of empty.
- Stream error with no text: unchanged — still throws the real error so the
  connector surfaces `"Error: …"`.
- Invalid/zero env or profile values: treat non-positive or `NaN` as "use the
  default" during resolution so a typo can't disable browsing or pin maxSteps to 0.

## Testing

- **config:** new env vars parsed; defaults applied when unset.
- **context resolution:** `profile override ?? config default`, including the
  non-positive/`NaN` → default guard.
- **runtime:** a fake model that only ever emits tool-calls, with `maxSteps: 2`,
  → `respond()` returns the budget-exhaustion message (not `"(no response)"`),
  and the message names the step count.
- **browse:** `browserEnvFor(id, dir, t)` makes `runAgentBrowser` use `t`; the
  `toResult` timeout path already returns a clean error.

## Risks / open questions

- The empty-reply root cause is *most consistent with* step-budget exhaustion but
  was not reproduced live. The diagnostic message is valuable regardless: it
  turns any future silent empty into an actionable signal naming the knob.
- AI SDK per-step `finishReason` is assumed available on `result.steps`; the
  implementation must confirm the exact field on the installed `ai` version and
  adjust the detection if the shape differs.
