# Team wizard flexibility: skip roles, per-role persona/name, clearer "no CLI"

**Date:** 2026-05-30
**Status:** Approved (design)

## Problem

The "New coding team" wizard always provisions the same five specialists
(PM, coder, security-reviewer, test-writer, tester) with fixed personas and
auto-generated names, and the only way to run a coding role without a coding CLI
("model only") is buried behind an unobvious dropdown label. Users want to: run
a role as a plain model agent and know that's what they're doing; build a leaner
team by leaving some roles out; and give a role a custom persona/name.

## Decisions (confirmed with the user)

- **"Normal agent (no CLI)" clarity** — relabel the existing `model only`
  dropdown option; no behavior change. CLI stays the default for coding roles.
- **Skip roles** — PM and Coder are mandatory; Security Reviewer, Test Writer,
  and Tester are skippable.
- **Per-role persona/name** — optional custom display name and persona per role,
  falling back to today's defaults.

## Design

### 1. Per-role config type

Extend `TeamRoleConfig` in `packages/server/src/teams/team-template.ts`:

```ts
export interface TeamRoleConfig {
  /** false → don't provision this role (ignored for the mandatory pm/coder). */
  enabled?: boolean;
  modelId?: string;
  tool?: string; // claude|codex|gemini|opencode|none
  /** Custom display name; defaults to "<project> · <RoleSuffix>". */
  displayName?: string;
  /** Custom persona; defaults to the role's built-in persona. */
  persona?: string;
}
```

`TeamConfig` stays `Record<string, TeamRoleConfig>`.

### 2. `provisionProjectTeam` (orchestrator)

- **Inclusion rule:** a role is provisioned when it's `pm`/`coder` OR
  `config[role]?.enabled !== false`. So an omitted role still provisions (back-
  compat for partial configs/tests); the wizard sends `enabled: false` to skip.
  Compute the included set first (a `Set<string>` of role names).
- **Skip loop:** `if (!included.has(spec.role)) continue;` before creating.
- **PM peer wiring:** when `spec.peerAllTeam`, only add peers for roles in the
  included set (don't wire the PM to a role that won't exist).
- **Per-role name/persona:** in the `createAgent({...})` call,
  - `displayName: rc.displayName?.trim() || \`${project.name} · ${spec.displayNameSuffix}\``
  - `persona: rc.persona?.trim() || (modelOnly && spec.personaModelOnly ? spec.personaModelOnly : spec.persona)`

Everything else (modelOnly handling, capability install, membership, setTeamRole)
is unchanged.

### 3. Pipeline: run only the stages that have a role (`PipelineManager`)

Today `drive()` uses a single fixed `this.stages` and **fails the run** if a
stage's role has no agent (`pipeline-manager.ts:168`). Make the effective stage
list per-project:

- Add an optional dep `resolveStages?: (projectId: string) => Stage[]` to
  `PipelineDeps`.
- In `drive()`, compute once at the top:
  `const stages = this.deps.resolveStages?.(run.projectId) ?? this.stages;`
  and replace the three `this.stages` uses inside `drive` with `stages`
  (the initial index, the `while (i < stages.length)` bound, and the kickback
  `stages.indexOf("coder")`).
- `startRun` still seeds `currentStage` from `this.stages[0]` — that's `"coder"`,
  which is always present, so no change needed there.

Orchestrator wires the dep where it constructs `PipelineManager`:

```ts
resolveStages: (projectId) =>
  DEFAULT_STAGES.filter((s) => this.projects.agentForRole(projectId, s) != null),
```

(import `DEFAULT_STAGES` from `../pipeline/pipeline-manager.js`). A skipped role's
stage is simply absent from the list, so the run flows past it instead of
erroring. (`security-reviewer` and `tester` are gate stages; if skipped, there's
just no gate there — intended.)

### 4. API route

`POST /api/projects` body `team` type becomes:

```ts
team?: Record<string, {
  enabled?: boolean;
  modelId?: string;
  tool?: string;
  displayName?: string;
  persona?: string;
}>;
```

No handler logic change — it already forwards `team` to `provisionProjectTeam`.

### 5. Wizard (`AgentWizard.tsx` `TeamForm`)

- **Relabel** the tool option: `<option value="model">normal agent (no CLI)</option>`
  (was "model only"), and update the helper paragraph to say "normal agent (no
  CLI)".
- **Role spec** gains `optional: boolean` (true for security-reviewer,
  test-writer, tester; PM and coder stay mandatory).
- **Per-role state** becomes
  `{ enabled: boolean; modelId: string; tool?: ToolChoice; displayName: string; persona: string }`,
  default `enabled: true`.
- **Each optional role row** gets an "include" checkbox (mandatory roles render
  no checkbox / are always enabled). When unchecked, the role's model/tool/
  customize controls are disabled or hidden.
- **Per-role "Customize"** — a small expander toggle per role revealing an
  optional display-name input and a persona textarea (placeholder shows the
  default persona is used when blank). Keeps the default form compact.
- **Payload:** send every role with `enabled`, plus `modelId`/`tool` as today and
  `displayName`/`persona` only when non-empty. Mandatory roles always
  `enabled: true`.

## Testing

- `pipeline-manager.test.ts` — with a `resolveStages` that returns a subset
  (e.g. `["coder"]`), `drive()` runs only those stages and finishes `done`
  (no "No agent for stage" error). A second case: `resolveStages` returning
  `["coder","tester"]` runs both.
- `orchestrator.test.ts` — `provisionProjectTeam` with
  `{ "test-writer": { enabled: false }, coder: { displayName: "Ace", persona: "Custom." } }`
  creates no test-writer (absent from `getProjectTeam`), keeps pm+coder, and the
  coder agent has the custom display name. (Uses `createTestStack`.)
- Build both packages; full server suite green.

## Verification

1. `pnpm --filter @otterbot/server build` and `pnpm --filter @otterbot/web build`.
2. `pnpm --filter @otterbot/server test`.
3. Manual: open New coding team → uncheck Test Writer + Tester, set the Coder to
   "normal agent (no CLI)", give Security Reviewer a custom name/persona, create.
   Confirm only PM/coder/security agents exist, the names/personas match, and a
   pipeline run executes `coder → security-reviewer` (no test-writer/tester
   stages, no error).

## Out of scope

- Reusing an existing agent to fill a role (separate, larger change).
- Making "normal agent (no CLI)" the default (explicitly kept as opt-in).
- Per-role transport/email/peer-access (single-agent editor territory).
