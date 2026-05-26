# Configurable Turn Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the browser-command timeout and the model step budget per-turn configurable (env default → per-agent override), and turn the silent `"(no response)"` empty reply into a diagnostic when the step budget is exhausted.

**Architecture:** Two env-backed defaults in `Config`; two nullable override fields on `AgentProfile`; the orchestrator resolves `override ?? default` into the `AgentContext` as plain numbers via a pure helper. The browse tool reads the resolved timeout off `BrowserEnv`; the runtime passes the resolved `maxSteps` to `streamText` and, when a turn ends empty because it hit the cap, substitutes a clear message. Per-agent values are editable in the Agent Studio editor.

**Tech Stack:** TypeScript, Node, Vitest, Vercel AI SDK (`ai@4.3.19`), React (web), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-05-25-configurable-turn-limits-design.md`

---

## File Structure

- `packages/shared/src/agent.ts` — add `browseTimeoutMs`, `maxSteps` to `AgentProfile`.
- `packages/server/src/config.ts` — add `browseTimeoutMs`, `agentMaxSteps` to `Config` + `loadConfig`.
- `packages/server/src/config.test.ts` *(new)* — env parsing + defaults.
- `packages/server/src/profiles/profile-store.ts` — default both fields to `null` in `normalizeProfile` and the COO scaffold.
- `packages/server/src/runtime/agent-context.ts` — `resolveTurnLimits` helper, `AgentContext` fields, `BuildAgentContextInput` fields, wiring.
- `packages/server/src/runtime/agent-context.test.ts` *(new)* — `resolveTurnLimits` unit tests.
- `packages/server/src/orchestrator/orchestrator.ts` — pass config defaults into `buildAgentContext`; inherit overrides in `buildSubagentProfile`.
- `packages/server/src/integrations/browser.ts` — `timeoutMs` on `BrowserEnv`, `browserEnvFor` arg, `runAgentBrowser` honors it.
- `packages/server/src/integrations/browser.test.ts` — assert `browserEnvFor` carries the timeout.
- `packages/server/src/agent/tools.ts` — build the browse env with `ctx.browseTimeoutMs`.
- `packages/server/src/runtime/agent-runtime.ts` — `stepBudgetMessage` helper, pass `maxSteps`, apply the message.
- `packages/server/src/runtime/step-budget.test.ts` *(new)* — `stepBudgetMessage` unit tests.
- `packages/web/src/components/agents/AgentEditor.tsx` — two override inputs.
- `.env.example` — document both env vars.

---

## Task 1: Shared override fields + config defaults

**Files:**
- Modify: `packages/shared/src/agent.ts:207` (after `dispatchToSubagent`)
- Modify: `packages/server/src/config.ts`
- Test: `packages/server/src/config.test.ts` (create)

- [ ] **Step 1: Add the override fields to `AgentProfile`**

In `packages/shared/src/agent.ts`, immediately after the `dispatchToSubagent: boolean;` field (line 207), add:

```ts
  /**
   * Per-call browser-command timeout in ms. `null` inherits the global default
   * (`OTTERBOT_BROWSE_TIMEOUT_MS`). Raise it for agents that browse slow pages.
   */
  browseTimeoutMs: number | null;
  /**
   * Max model steps (tool-call rounds) per turn. `null` inherits the global
   * default (`OTTERBOT_AGENT_MAX_STEPS`). Raise it for agents whose web tasks
   * need many snapshot/click rounds before answering.
   */
  maxSteps: number | null;
```

- [ ] **Step 2: Write the failing config test**

Create `packages/server/src/config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig turn limits", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OTTERBOT_BROWSE_TIMEOUT_MS;
    delete process.env.OTTERBOT_AGENT_MAX_STEPS;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("defaults browse timeout to 60s and max steps to 8", () => {
    const cfg = loadConfig();
    expect(cfg.browseTimeoutMs).toBe(60_000);
    expect(cfg.agentMaxSteps).toBe(8);
  });

  it("reads overrides from env", () => {
    process.env.OTTERBOT_BROWSE_TIMEOUT_MS = "180000";
    process.env.OTTERBOT_AGENT_MAX_STEPS = "16";
    const cfg = loadConfig();
    expect(cfg.browseTimeoutMs).toBe(180_000);
    expect(cfg.agentMaxSteps).toBe(16);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- config.test`
Expected: FAIL — `cfg.browseTimeoutMs` / `cfg.agentMaxSteps` are `undefined` (not yet on `Config`).

- [ ] **Step 4: Add the fields to `Config` and `loadConfig`**

In `packages/server/src/config.ts`, add to the `Config` interface after `subagentGraceMs: number;`:

```ts
  /** Default per-call browser-command timeout (ms). Per-agent profiles override. */
  browseTimeoutMs: number;
  /** Default max model steps (tool-call rounds) per turn. Per-agent profiles override. */
  agentMaxSteps: number;
```

In `loadConfig()`'s returned object, after `subagentGraceMs: Number(process.env.SUBAGENT_GRACE_MS ?? 300_000),` add:

```ts
    browseTimeoutMs: Number(process.env.OTTERBOT_BROWSE_TIMEOUT_MS ?? 60_000),
    agentMaxSteps: Number(process.env.OTTERBOT_AGENT_MAX_STEPS ?? 8),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- config.test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/agent.ts packages/server/src/config.ts packages/server/src/config.test.ts
git commit -m "config: add browseTimeoutMs + agentMaxSteps defaults and per-agent override fields"
```

---

## Task 2: Profile defaults + subagent inheritance

**Files:**
- Modify: `packages/server/src/profiles/profile-store.ts:241` (COO scaffold) and `:305` (normalizeProfile)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`buildSubagentProfile`, near line 1790)
- Test: `packages/server/src/orchestrator/orchestrator.test.ts:157` (extend existing inheritance test)

- [ ] **Step 1: Extend the failing subagent-inheritance test**

In `packages/server/src/orchestrator/orchestrator.test.ts`, find the test `"buildSubagentProfile inherits the parent's capability fields"` (line 157). It builds a `parent` then a `sub`. Add `browseTimeoutMs` / `maxSteps` to the parent it creates and assert they propagate. Locate the `buildSubagentProfile(parent, { … })` call (around line 165) and after the existing assertions in that test add:

```ts
    expect(sub.browseTimeoutMs).toBe(parent.browseTimeoutMs);
    expect(sub.maxSteps).toBe(parent.maxSteps);
```

Then ensure the `parent` used by this test has non-null values. The test creates the parent via `stack.orch.createAgent(...)` / `updateAgent`. Set them with an update before building the sub, immediately before the `buildSubagentProfile` call:

```ts
    stack.orch.updateAgent(parent.id, { browseTimeoutMs: 120_000, maxSteps: 16 });
    const refreshed = stack.orch.getContext(parent.id)!.profile;
```

and pass `refreshed` (not `parent`) into `buildSubagentProfile(refreshed, { … })`, and assert against `refreshed`:

```ts
    expect(sub.browseTimeoutMs).toBe(120_000);
    expect(sub.maxSteps).toBe(16);
```

(Use whichever variable the existing test already passes to `buildSubagentProfile`; the point is the parent has `browseTimeoutMs: 120_000, maxSteps: 16` set before the sub is built.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- orchestrator.test -t "buildSubagentProfile inherits"`
Expected: FAIL — `sub.browseTimeoutMs` is `null` (not inherited; `buildSubagentProfile` doesn't copy it yet).

- [ ] **Step 3: Inherit the fields in `buildSubagentProfile`**

In `packages/server/src/orchestrator/orchestrator.ts`, inside `buildSubagentProfile`'s `normalizeProfile({ … })` object (the block that already sets `canRunShell: parent.canRunShell,` and `canWebSearch: parent.canWebSearch,`), add alongside them:

```ts
    browseTimeoutMs: parent.browseTimeoutMs,
    maxSteps: parent.maxSteps,
```

- [ ] **Step 4: Default the fields in `normalizeProfile` and the COO scaffold**

In `packages/server/src/profiles/profile-store.ts`, in `normalizeProfile`'s returned object, after `canWebSearch: p.canWebSearch ?? false,` (line 302) add:

```ts
    browseTimeoutMs: p.browseTimeoutMs ?? null,
    maxSteps: p.maxSteps ?? null,
```

In the COO scaffold object (the `profile` literal around lines 234–241), after `canWebSearch: false,` add:

```ts
      browseTimeoutMs: null,
      maxSteps: null,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- orchestrator.test -t "buildSubagentProfile inherits"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/profiles/profile-store.ts packages/server/src/orchestrator/orchestrator.ts packages/server/src/orchestrator/orchestrator.test.ts
git commit -m "profiles: default turn-limit overrides to null and inherit them in subagents"
```

---

## Task 3: Limit resolution helper + context wiring

**Files:**
- Modify: `packages/server/src/runtime/agent-context.ts`
- Modify: `packages/server/src/orchestrator/orchestrator.ts:898` (the `buildAgentContext({ … })` call)
- Test: `packages/server/src/runtime/agent-context.test.ts` (create)

- [ ] **Step 1: Write the failing resolver test**

Create `packages/server/src/runtime/agent-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveTurnLimits } from "./agent-context.js";

const defaults = { browseTimeoutMs: 60_000, maxSteps: 8 };

describe("resolveTurnLimits", () => {
  it("uses defaults when overrides are null", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: null, maxSteps: null }, defaults)).toEqual({
      browseTimeoutMs: 60_000,
      maxSteps: 8,
    });
  });

  it("uses positive overrides", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: 180_000, maxSteps: 16 }, defaults)).toEqual({
      browseTimeoutMs: 180_000,
      maxSteps: 16,
    });
  });

  it("falls back to defaults for non-positive or non-finite overrides", () => {
    expect(resolveTurnLimits({ browseTimeoutMs: 0, maxSteps: -1 }, defaults)).toEqual(defaults);
    expect(
      resolveTurnLimits({ browseTimeoutMs: NaN, maxSteps: Infinity }, defaults)
    ).toEqual(defaults);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- agent-context.test`
Expected: FAIL — `resolveTurnLimits` is not exported / not defined.

- [ ] **Step 3: Add the resolver and context fields**

In `packages/server/src/runtime/agent-context.ts`:

(a) Export the helper (place it just above `export function buildAgentContext`):

```ts
/**
 * Effective per-turn limits. A finite, positive profile override wins; anything
 * else (null, 0, negative, NaN, Infinity) falls back to the global default —
 * so a stray value can never disable browsing or pin the step budget to 0.
 */
export function resolveTurnLimits(
  override: { browseTimeoutMs: number | null; maxSteps: number | null },
  defaults: { browseTimeoutMs: number; maxSteps: number }
): { browseTimeoutMs: number; maxSteps: number } {
  const pos = (v: number | null, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    browseTimeoutMs: pos(override.browseTimeoutMs, defaults.browseTimeoutMs),
    maxSteps: pos(override.maxSteps, defaults.maxSteps),
  };
}
```

(b) Add the resolved fields to the `AgentContext` interface (after `browserProfileDir: string;`):

```ts
  /** Effective per-call browser-command timeout (ms): profile override or global default. */
  browseTimeoutMs: number;
  /** Effective max model steps per turn: profile override or global default. */
  maxSteps: number;
```

(c) Add the global defaults to `BuildAgentContextInput` (after `dbKey?: string | null;`):

```ts
  /** Global default per-call browser timeout (ms); profile may override. */
  defaultBrowseTimeoutMs: number;
  /** Global default max steps per turn; profile may override. */
  defaultMaxSteps: number;
```

(d) In `buildAgentContext`, compute the limits before building `ctx` (after the `flatSecrets` loop):

```ts
  const limits = resolveTurnLimits(
    { browseTimeoutMs: input.profile.browseTimeoutMs, maxSteps: input.profile.maxSteps },
    { browseTimeoutMs: input.defaultBrowseTimeoutMs, maxSteps: input.defaultMaxSteps }
  );
```

and add to the `ctx` object literal (after `browserProfileDir: input.browserProfileDir,`):

```ts
    browseTimeoutMs: limits.browseTimeoutMs,
    maxSteps: limits.maxSteps,
```

- [ ] **Step 4: Pass the config defaults at the build site**

In `packages/server/src/orchestrator/orchestrator.ts`, in the `buildAgentContext({ … })` call (line 898), add after `dbKey: this.cfg.dbKey,`:

```ts
      defaultBrowseTimeoutMs: this.cfg.browseTimeoutMs,
      defaultMaxSteps: this.cfg.agentMaxSteps,
```

- [ ] **Step 5: Run the resolver test and full server build**

Run: `pnpm --filter @otterbot/server test -- agent-context.test`
Expected: PASS (3 tests).
Run: `pnpm --filter @otterbot/server build`
Expected: clean (`tsc` exits 0 — confirms every `buildAgentContext` caller supplies the new required inputs).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/runtime/agent-context.ts packages/server/src/runtime/agent-context.test.ts packages/server/src/orchestrator/orchestrator.ts
git commit -m "runtime: resolve effective browse timeout + max steps onto AgentContext"
```

---

## Task 4: Thread the browse timeout into the browser tool

**Files:**
- Modify: `packages/server/src/integrations/browser.ts`
- Modify: `packages/server/src/agent/tools.ts:508`
- Test: `packages/server/src/integrations/browser.test.ts`

- [ ] **Step 1: Write the failing test for `browserEnvFor`**

In `packages/server/src/integrations/browser.test.ts`, add a top-level (not skipped) test — `browserEnvFor` is pure and needs no Chrome. Add near the imports/top of the file:

```ts
import { describe as describe2, expect as expect2, it as it2 } from "vitest";

describe2("browserEnvFor", () => {
  it2("carries an explicit per-call timeout", () => {
    const env = browserEnvFor("agent-x", "/tmp/profile", 180_000);
    expect2(env.timeoutMs).toBe(180_000);
  });
  it2("leaves timeout unset when none is given", () => {
    const env = browserEnvFor("agent-x", "/tmp/profile");
    expect2(env.timeoutMs).toBeUndefined();
  });
});
```

(If `vitest` symbols are already imported at the top of the file, reuse those names instead of the aliased imports — the aliases just avoid a duplicate-import error if you append at the bottom.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- browser.test -t browserEnvFor`
Expected: FAIL — `env.timeoutMs` is `undefined` even when passed (and `browserEnvFor` rejects the 3rd arg / `BrowserEnv` has no `timeoutMs`).

- [ ] **Step 3: Add `timeoutMs` to `BrowserEnv`, `browserEnvFor`, and `runAgentBrowser`**

In `packages/server/src/integrations/browser.ts`:

(a) Add `timeoutMs?: number;` to the `BrowserEnv` interface/type (the shape returned by `browserEnvFor`, holding `session`/`profileDir`).

(b) Update `browserEnvFor` signature and return to accept and store it:

```ts
export function browserEnvFor(agentId: string, profileDir: string, timeoutMs?: number): BrowserEnv {
```

and include `timeoutMs` in the returned object (only when defined is fine; an explicit `timeoutMs,` shorthand also works since the field is optional).

(c) In `runAgentBrowser`, change the default-parameter line (currently `timeoutMs = DEFAULT_TIMEOUT_MS`) so callers that pass only `(env, args)` pick up the env's value. Replace the parameter default with an in-body resolution:

```ts
async function runAgentBrowser(
  env: BrowserEnv,
  args: string[],
  timeoutMs = env.timeoutMs ?? DEFAULT_TIMEOUT_MS
): Promise<RawRun> {
```

(Default-parameter expressions may reference earlier parameters, so `env.timeoutMs` is in scope here.)

- [ ] **Step 4: Build the browse env with the resolved timeout in `tools.ts`**

In `packages/server/src/agent/tools.ts` line 508, change:

```ts
    const browser = browserEnvFor(ctx.profile.id, ctx.browserProfileDir);
```

to:

```ts
    const browser = browserEnvFor(ctx.profile.id, ctx.browserProfileDir, ctx.browseTimeoutMs);
```

- [ ] **Step 5: Run the test and build**

Run: `pnpm --filter @otterbot/server test -- browser.test -t browserEnvFor`
Expected: PASS (2 tests).
Run: `pnpm --filter @otterbot/server build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/integrations/browser.ts packages/server/src/agent/tools.ts packages/server/src/integrations/browser.test.ts
git commit -m "browser: honor a per-agent browse-command timeout from AgentContext"
```

---

## Task 5: Step budget wiring + budget-exhaustion message

**Files:**
- Modify: `packages/server/src/runtime/agent-runtime.ts` (line 214 `maxSteps`, the post-stream block near 261–313)
- Test: `packages/server/src/runtime/step-budget.test.ts` (create)

- [ ] **Step 1: Write the failing test for `stepBudgetMessage`**

Create `packages/server/src/runtime/step-budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { stepBudgetMessage } from "./agent-runtime.js";

describe("stepBudgetMessage", () => {
  it("returns a diagnostic when empty text ends on a tool-call step", () => {
    const msg = stepBudgetMessage("", "tool-calls", 8);
    expect(msg).not.toBeNull();
    expect(msg).toContain("8");
  });

  it("returns null when the model produced text", () => {
    expect(stepBudgetMessage("here is the answer", "tool-calls", 8)).toBeNull();
  });

  it("returns null when the turn stopped normally with no text", () => {
    expect(stepBudgetMessage("", "stop", 8)).toBeNull();
    expect(stepBudgetMessage("", undefined, 8)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test -- step-budget.test`
Expected: FAIL — `stepBudgetMessage` is not exported.

- [ ] **Step 3: Add the `stepBudgetMessage` helper**

In `packages/server/src/runtime/agent-runtime.ts`, at module scope (near the other top-level helpers, e.g. above the `AgentRuntime` class), add:

```ts
/**
 * When a turn ends with no text purely because it exhausted its step budget
 * (the last step still wanted to call tools), return a message that explains
 * that instead of the silent "(no response)". Returns null otherwise.
 */
export function stepBudgetMessage(
  finalText: string,
  lastFinishReason: string | undefined,
  maxSteps: number
): string | null {
  if (finalText.trim()) return null;
  if (lastFinishReason !== "tool-calls") return null;
  return (
    `I reached my step budget (${maxSteps} steps) before finishing this task. ` +
    `Try narrowing the request, or raise this agent's max steps.`
  );
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --filter @otterbot/server test -- step-budget.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Pass the resolved `maxSteps` to `streamText`**

In `packages/server/src/runtime/agent-runtime.ts`, change line 214 from:

```ts
        maxSteps: 8,
```

to:

```ts
        maxSteps: this.ctx.maxSteps,
```

- [ ] **Step 6: Capture the last finish reason and apply the message**

In `respond()`, the block that reads steps currently starts at:

```ts
      try {
        for (const step of await result.steps) {
```

Declare a holder before the `try` (next to `let finalText = ""` etc., e.g. after `let streamError: string | null = null;`):

```ts
      let lastFinishReason: string | undefined;
```

Then change the loop header to capture the steps array and the last finish reason:

```ts
      try {
        const completedSteps = await result.steps;
        lastFinishReason = completedSteps.at(-1)?.finishReason;
        for (const step of completedSteps) {
```

(The rest of the loop body is unchanged.)

Then, immediately after the existing stream-error throw block:

```ts
      if (!finalText && streamError) {
        throw new Error(streamError);
      }
```

add:

```ts
      // A turn that hit its step cap with no closing text would otherwise post a
      // silent "(no response)" — name the limit instead so it's actionable.
      const budgetMsg = stepBudgetMessage(finalText, lastFinishReason, this.ctx.maxSteps);
      if (budgetMsg) finalText = budgetMsg;
```

- [ ] **Step 7: Run server tests + build**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS (all existing tests plus the new ones).
Run: `pnpm --filter @otterbot/server build`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/runtime/agent-runtime.ts packages/server/src/runtime/step-budget.test.ts
git commit -m "runtime: configurable maxSteps + diagnostic when the step budget is exhausted"
```

---

## Task 6: Per-agent overrides in the Agent Studio editor

**Files:**
- Modify: `packages/web/src/components/agents/AgentEditor.tsx`

- [ ] **Step 1: Add the two fields to `FormState` and `BLANK`**

In `packages/web/src/components/agents/AgentEditor.tsx`, add to the `FormState` interface (after `dispatchToSubagent: boolean;`):

```ts
  browseTimeoutMs: string;
  maxSteps: string;
```

(Strings: an empty input means "inherit" → `null` on save.)

Add to `BLANK` (after `dispatchToSubagent: false,`):

```ts
  browseTimeoutMs: "",
  maxSteps: "",
```

- [ ] **Step 2: Load existing values into the form**

In the `setForm({ … })` call inside the `agentId` effect (around line 82), add (after `dispatchToSubagent: p.dispatchToSubagent ?? false,`):

```ts
          browseTimeoutMs: p.browseTimeoutMs != null ? String(p.browseTimeoutMs) : "",
          maxSteps: p.maxSteps != null ? String(p.maxSteps) : "",
```

- [ ] **Step 3: Include the values in the save payload**

In `onSave`, in the `payload` object (after `dispatchToSubagent: form.canSpawnSubagents && form.dispatchToSubagent,`), add:

```ts
        browseTimeoutMs: form.browseTimeoutMs.trim() === "" ? null : Number(form.browseTimeoutMs),
        maxSteps: form.maxSteps.trim() === "" ? null : Number(form.maxSteps),
```

- [ ] **Step 4: Render the two inputs**

In the JSX, after the `dispatchToSubagent` `<label>…</label>` block (ends around line 295) and before the `<p style={hintStyle}>Connect this agent…` paragraph, add:

```tsx
        <Field label="Browser command timeout (ms) — blank inherits the global default (60000)">
          <input
            type="number"
            min={0}
            value={form.browseTimeoutMs}
            onChange={(e) => patch({ browseTimeoutMs: e.target.value })}
            placeholder="inherit (60000)"
            style={inputStyle}
          />
        </Field>

        <Field label="Max steps per turn — blank inherits the global default (8)">
          <input
            type="number"
            min={1}
            value={form.maxSteps}
            onChange={(e) => patch({ maxSteps: e.target.value })}
            placeholder="inherit (8)"
            style={inputStyle}
          />
        </Field>
```

(`Field` and `inputStyle` are already defined/used in this file — confirm by the existing "Email address" `Field` + `inputStyle` usage around line 261.)

- [ ] **Step 5: Build the web package**

Run: `pnpm --filter @otterbot/web build`
Expected: clean (`tsc` + `vite build` succeed; `payload` typed as `Partial<AgentProfile>` accepts `browseTimeoutMs` / `maxSteps`).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/agents/AgentEditor.tsx
git commit -m "web: edit per-agent browse timeout and max steps in the agent editor"
```

---

## Task 7: Document env vars + final verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Document the env vars**

In `.env.example`, near the existing `SUBAGENT_GRACE_MS` entry (or in the general server-config section), add:

```bash
# Default per-call browser-command timeout in ms (agent profiles can override).
# Raise it if agents browse slow pages. Default: 60000.
OTTERBOT_BROWSE_TIMEOUT_MS=60000

# Default max model steps (tool-call rounds) per turn (agent profiles can override).
# Raise it if multi-step web tasks end with an empty/"step budget" reply. Default: 8.
OTTERBOT_AGENT_MAX_STEPS=8
```

- [ ] **Step 2: Full workspace verification**

Run: `pnpm --filter @otterbot/server test`
Expected: PASS (all suites).
Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/web build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: document OTTERBOT_BROWSE_TIMEOUT_MS and OTTERBOT_AGENT_MAX_STEPS"
```

---

## Self-Review Notes

- **Spec coverage:** config defaults (Task 1) ✓; per-agent overrides + null-inherit (Tasks 1–2) ✓; subagent inheritance (Task 2) ✓; resolution helper with non-positive/NaN guard (Task 3) ✓; browse timeout threading (Task 4) ✓; configurable maxSteps + budget-exhaustion message (Task 5) ✓; Agent Studio UI (Task 6) ✓; env docs (Task 7) ✓. Defaults unchanged (8 / 60000) preserved throughout. Out-of-scope items (model-HTTP/delegate timeouts) intentionally untouched.
- **Type consistency:** `Config.agentMaxSteps` + `Config.browseTimeoutMs`; `AgentProfile.maxSteps` + `AgentProfile.browseTimeoutMs` (nullable); `AgentContext.maxSteps` + `AgentContext.browseTimeoutMs` (resolved numbers); `BuildAgentContextInput.defaultMaxSteps` + `.defaultBrowseTimeoutMs`; `resolveTurnLimits(override, defaults)` where `defaults` uses key `maxSteps` (mapped from `cfg.agentMaxSteps` at the call site); `stepBudgetMessage(finalText, lastFinishReason, maxSteps)`. These names are used consistently across tasks.
- **AI SDK assumption (verified):** `ai@4.3.19` `StepResult.finishReason` is a `FinishReason` that includes `"tool-calls"`, and `streamText` result `.steps` is awaitable — confirmed in `node_modules/.pnpm/ai@4.3.19_.../dist/index.d.ts`.
