# Team Wizard Flexibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the New-coding-team wizard skip optional roles, set a per-role custom name/persona, and clearly run a coding role as a plain "normal agent (no CLI)".

**Architecture:** Extend the per-role config (`TeamRoleConfig`) with `enabled`/`displayName`/`persona`; `provisionProjectTeam` honors them (PM+Coder always created). The pipeline derives each run's stage list from the roles that actually exist (new `resolveStages` dep) so a skipped role's stage is simply not run. The wizard gains include checkboxes, a per-role Customize expander, and a relabeled "normal agent (no CLI)" option.

**Tech Stack:** TypeScript, Fastify, Drizzle/better-sqlite3, Vitest (server); React + Zustand (web).

---

## File Structure

- `packages/server/src/pipeline/pipeline-manager.ts` — `resolveStages` dep + per-run stage list in `drive()`.
- `packages/server/src/pipeline/pipeline-manager.test.ts` — stage-filtering tests.
- `packages/server/src/orchestrator/orchestrator.ts` — wire `resolveStages`; `provisionProjectTeam` skip + name/persona.
- `packages/server/src/orchestrator/orchestrator.test.ts` — provision skip/custom test.
- `packages/server/src/teams/team-template.ts` — `TeamRoleConfig` fields.
- `packages/server/src/server.ts` — `POST /api/projects` body `team` type.
- `packages/web/src/components/agents/AgentWizard.tsx` — wizard UI.

All commands run from repo root `/home/mreeves/Projects/Personal/otter/otterbot`.

---

## Task 1: Pipeline runs only the stages whose roles resolve

**Files:**
- Modify: `packages/server/src/pipeline/pipeline-manager.ts` (`PipelineDeps`, `drive()`)
- Test: `packages/server/src/pipeline/pipeline-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

In `pipeline-manager.test.ts`, add these two tests inside the
`describe("PipelineManager", ...)` block (after the existing "runs all stages in
order" test, around line 54):

```ts
  it("runs only the stages whose roles resolve (resolveStages subset)", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => ["coder", "tester"],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "build it");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["coder", "tester"]);
    expect(pm.get(runId)?.status).toBe("done");
  });

  it("finishes done when only the coder stage resolves (no missing-agent error)", async () => {
    const calls: string[] = [];
    const pm = new PipelineManager({
      control,
      resolveAgent,
      resolveStages: () => ["coder"],
      runStage: async ({ stage }) => {
        calls.push(stage);
        return { report: `did ${stage}` };
      },
    });
    const runId = pm.startRun("proj1", "go");
    await waitFor(() => pm.get(runId)?.status === "done");
    expect(calls).toEqual(["coder"]);
    expect(pm.view(runId)!.stages.every((s) => s.status !== "error")).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/server && pnpm exec vitest run src/pipeline/pipeline-manager.test.ts -t "resolve"`
Expected: FAIL — `resolveStages` isn't a known dep / has no effect, so the run
executes all four default stages (or TS errors on the unknown property).

- [ ] **Step 3: Add the `resolveStages` dep**

In `pipeline-manager.ts`, in the `PipelineDeps` interface, add after the
`stages?: Stage[];` line:

```ts
  /** Stage order; defaults to DEFAULT_STAGES. */
  stages?: Stage[];
  /**
   * Per-project effective stage list (e.g. drop stages whose role was skipped).
   * Falls back to `stages`/DEFAULT_STAGES when omitted.
   */
  resolveStages?: (projectId: string) => Stage[];
```

- [ ] **Step 4: Use the effective stage list in `drive()`**

In `pipeline-manager.ts`, replace the body of `drive()` from its start down to the
end of the `while` loop with this (keeps all existing logic, swapping the fixed
`this.stages` for a per-run `stages`):

```ts
  private async drive(runId: string): Promise<void> {
    let run = this.get(runId);
    if (!run) return;
    // The effective stage list can be narrower than the default when a project
    // skips optional roles — a stage whose role has no agent is left out here
    // rather than failing the run mid-flight.
    const stages = this.deps.resolveStages?.(run.projectId) ?? this.stages;
    let i = Math.max(0, stages.indexOf(run.currentStage ?? stages[0]));

    while (i < stages.length) {
      run = this.get(runId);
      if (!run || run.status !== "running") return; // cancelled / gone
      const stage = stages[i];
      this.setCurrentStage(runId, stage);

      const agentId = this.deps.resolveAgent(run.projectId, stage);
      if (!agentId) {
        this.recordStage(runId, stage, "(none)", "error", `No agent for stage "${stage}".`, run.attempt);
        this.finish(runId, "failed");
        return;
      }

      const priorReports = this.stageHistory(runId).map((s) => ({ stage: s.stage, report: s.report }));
      let outcome: StageOutcome;
      try {
        outcome = await this.deps.runStage({
          projectId: run.projectId,
          runId,
          stage,
          agentId,
          goal: run.goal,
          priorReports,
        });
      } catch (err) {
        this.recordStage(runId, stage, agentId, "error", err instanceof Error ? err.message : String(err), run.attempt);
        this.finish(runId, "failed");
        return;
      }

      const pass = outcome.pass ?? parseVerdict(outcome.report);
      this.recordStage(runId, stage, agentId, pass ? "pass" : "fail", outcome.report, run.attempt);

      if (!pass && GATE_STAGES.has(stage)) {
        // Kick back to the coder, bounded by MAX_ATTEMPTS.
        const nextAttempt = run.attempt + 1;
        if (nextAttempt > MAX_ATTEMPTS) {
          this.finish(runId, "failed");
          return;
        }
        this.bumpAttempt(runId, nextAttempt);
        i = Math.max(0, stages.indexOf("coder"));
        continue;
      }

      i += 1;
    }
    this.finish(runId, "done");
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/server && pnpm exec vitest run src/pipeline/pipeline-manager.test.ts`
Expected: PASS (all PipelineManager tests, including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/pipeline/pipeline-manager.ts packages/server/src/pipeline/pipeline-manager.test.ts
git commit -m "Pipeline: run only the stages whose roles resolve"
```

---

## Task 2: Wire `resolveStages` from the orchestrator

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (pipeline-manager import + `new PipelineManager({...})` deps)

- [ ] **Step 1: Import `DEFAULT_STAGES`**

In `orchestrator.ts`, find the import of `PipelineManager` from
`"../pipeline/pipeline-manager.js"` (around line 42, inside a multi-name import
block) and add `DEFAULT_STAGES` to it. For example if it reads:

```ts
import {
  PipelineManager,
```

change it to:

```ts
import {
  PipelineManager,
  DEFAULT_STAGES,
```

(Keep the rest of that import's names intact.)

- [ ] **Step 2: Add the `resolveStages` dep**

In `orchestrator.ts`, in the `this.pipeline = new PipelineManager({ ... })` call,
add this property next to the existing `resolveAgent:` line:

```ts
      resolveAgent: (projectId, role) => this.projects.agentForRole(projectId, role),
      resolveStages: (projectId) =>
        DEFAULT_STAGES.filter((s) => this.projects.agentForRole(projectId, s) != null),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @otterbot/server build`
Expected: exit 0 (confirms `DEFAULT_STAGES` is exported and `agentForRole` exists
on the project store).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts
git commit -m "Derive a project's pipeline stages from its provisioned roles"
```

---

## Task 3: Per-role enable/name/persona in provisioning

**Files:**
- Modify: `packages/server/src/teams/team-template.ts` (`TeamRoleConfig`)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`provisionProjectTeam`)
- Test: `packages/server/src/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

In `orchestrator.test.ts`, add this test inside the `describe("orchestrator (e2e)", ...)`
block (near the other project tests, e.g. just before the final closing `});`):

```ts
  it("provisionProjectTeam skips disabled roles and applies a custom name", () => {
    const project = stack.orch.createProject("Lean Team");
    stack.orch.provisionProjectTeam(project.id, {
      coder: { displayName: "Ace Coder" },
      "test-writer": { enabled: false },
      tester: { enabled: false },
    });
    const team = stack.orch.getProjectTeam(project.id);
    // pm + coder are mandatory; security-reviewer defaults on; the two disabled
    // roles are not provisioned.
    expect(team.map((t) => t.role).sort()).toEqual(["coder", "pm", "security-reviewer"]);
    const coderId = team.find((t) => t.role === "coder")!.agentId;
    expect(stack.orch.getContext(coderId)!.profile.displayName).toBe("Ace Coder");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/server && pnpm exec vitest run src/orchestrator/orchestrator.test.ts -t "skips disabled"`
Expected: FAIL — all 5 roles are still provisioned (so the role list includes
`test-writer`/`tester`), and/or a TS error that `enabled`/`displayName` aren't on
`TeamRoleConfig`.

- [ ] **Step 3: Extend `TeamRoleConfig`**

In `team-template.ts`, replace the `TeamRoleConfig` interface with:

```ts
/** Per-role overrides supplied by the create-team wizard. */
export interface TeamRoleConfig {
  /**
   * false → don't provision this role. Ignored for the mandatory pm/coder roles.
   * Omitted/undefined means provision it (back-compat for partial configs).
   */
  enabled?: boolean;
  /** Chat model id for this role (defaults to the global default). */
  modelId?: string;
  /**
   * Pinned coding CLI for a coding role (claude | codex | gemini | opencode), or
   * "none" for "normal agent (no CLI)" — the role skips the coding-cli capability
   * and edits /project directly via shell_exec using just its model.
   */
  tool?: string;
  /** Custom display name; defaults to "<project> · <RoleSuffix>". */
  displayName?: string;
  /** Custom persona; defaults to the role's built-in persona. */
  persona?: string;
}
```

- [ ] **Step 4: Honor enable/name/persona in `provisionProjectTeam`**

In `orchestrator.ts`, in `provisionProjectTeam`, just after the
`if (!project) throw new Error(...)` line and before `for (const spec of TEAM_ROLES) {`,
add the included-role set:

```ts
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    // pm + coder are mandatory; any other role is provisioned unless the config
    // explicitly disables it.
    const included = new Set(
      TEAM_ROLES.filter(
        (spec) =>
          spec.role === "pm" || spec.role === "coder" || config[spec.role]?.enabled !== false
      ).map((spec) => spec.role)
    );
    for (const spec of TEAM_ROLES) {
      if (!included.has(spec.role)) continue;
```

(That replaces the bare `for (const spec of TEAM_ROLES) {` line — keep the rest of
the loop body.)

Then, inside the `if (spec.peerAllTeam) {` block, skip peers for roles that won't
exist — change the inner loop to:

```ts
      if (spec.peerAllTeam) {
        for (const other of TEAM_ROLES) {
          if (other.role === spec.role) continue;
          if (!included.has(other.role)) continue;
          peerIds.add(teamAgentId(projectId, other.role));
        }
      }
```

Finally, in the `this.createAgent({ ... })` call inside the loop, replace the
`displayName` and `persona` lines so they honor the per-role overrides:

```ts
      this.createAgent({
        id,
        displayName: rc.displayName?.trim() || `${project.name} · ${spec.displayNameSuffix}`,
        persona: rc.persona?.trim() || (modelOnly && spec.personaModelOnly ? spec.personaModelOnly : spec.persona),
        canRunShell: spec.canRunShell,
        allowedPeers,
        model: this.modelConfigFor(rc.modelId),
      });
```

(`rc` is the existing `const rc = config[spec.role] ?? {};` already defined in the
loop — do not redefine it.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/server && pnpm exec vitest run src/orchestrator/orchestrator.test.ts -t "skips disabled"`
Expected: PASS. Then run the full file: `pnpm exec vitest run src/orchestrator/orchestrator.test.ts` — all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/teams/team-template.ts packages/server/src/orchestrator/orchestrator.ts packages/server/src/orchestrator/orchestrator.test.ts
git commit -m "Provision teams with optional roles + per-role name/persona"
```

---

## Task 4: Accept the new per-role fields in the API

**Files:**
- Modify: `packages/server/src/server.ts` (`POST /api/projects` body type, ~line 303)

- [ ] **Step 1: Widen the `team` body type**

In `server.ts`, in the `POST /api/projects` handler, replace the `team?` line in
the `Body` type with:

```ts
      team?: Record<string, {
        enabled?: boolean;
        modelId?: string;
        tool?: string;
        displayName?: string;
        persona?: string;
      }>;
```

(No handler logic change — `req.body.team` is already forwarded to
`provisionProjectTeam`.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @otterbot/server build`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/server.ts
git commit -m "Accept per-role enabled/name/persona in the create-project API"
```

---

## Task 5: Wizard UI — include checkboxes, Customize, "normal agent (no CLI)"

**Files:**
- Modify: `packages/web/src/components/agents/AgentWizard.tsx` (`RoleSpec`, `ROLES`, `TeamForm`)

- [ ] **Step 1: Mark optional roles in `RoleSpec` + `ROLES`**

In `AgentWizard.tsx`, add an `optional` flag to the `RoleSpec` interface:

```ts
interface RoleSpec {
  role: string;
  label: string;
  /** Default coding CLI; undefined for non-coding roles (pm, tester). */
  defaultTool?: Tool;
  blurb: string;
  /** Skippable in the wizard (pm + coder are mandatory). */
  optional?: boolean;
}
```

And set `optional: true` on the three skippable roles in `ROLES`:

```ts
const ROLES: RoleSpec[] = [
  { role: "pm", label: "Project Manager", blurb: "Plans with you and runs the pipeline." },
  { role: "coder", label: "Coder", defaultTool: "claude", blurb: "Implements the feature." },
  { role: "security-reviewer", label: "Security Reviewer", defaultTool: "gemini", blurb: "Audits the code.", optional: true },
  { role: "test-writer", label: "Test Writer", defaultTool: "opencode", blurb: "Writes the tests.", optional: true },
  { role: "tester", label: "Tester", blurb: "Runs local tests; remote e2e is optional.", optional: true },
];
```

- [ ] **Step 2: Extend the per-role form state**

In `TeamForm`, replace the `roles` state initializer and add an `expanded` state.
Find:

```ts
  const [roles, setRoles] = useState<Record<string, { modelId: string; tool?: ToolChoice }>>(() =>
    Object.fromEntries(ROLES.map((r) => [r.role, { modelId: "", tool: r.defaultTool }]))
  );
```

Replace with:

```ts
  const [roles, setRoles] = useState<
    Record<string, { enabled: boolean; modelId: string; tool?: ToolChoice; displayName: string; persona: string }>
  >(() =>
    Object.fromEntries(
      ROLES.map((r) => [r.role, { enabled: true, modelId: "", tool: r.defaultTool, displayName: "", persona: "" }])
    )
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
```

- [ ] **Step 3: Build the payload with enabled/name/persona**

In `TeamForm`'s `create()`, replace the team-building loop:

```ts
    const team: Record<string, { modelId?: string; tool?: string }> = {};
    for (const r of ROLES) {
      const cfg = roles[r.role];
      team[r.role] = {
        ...(cfg.modelId ? { modelId: cfg.modelId } : {}),
        // "model" → "none" tells the server to skip the coding CLI for this role.
        ...(cfg.tool ? { tool: cfg.tool === "model" ? "none" : cfg.tool } : {}),
      };
    }
```

with:

```ts
    const team: Record<
      string,
      { enabled: boolean; modelId?: string; tool?: string; displayName?: string; persona?: string }
    > = {};
    for (const r of ROLES) {
      const cfg = roles[r.role];
      team[r.role] = {
        // pm + coder are always enabled; optional roles follow their checkbox.
        enabled: r.optional ? cfg.enabled : true,
        ...(cfg.modelId ? { modelId: cfg.modelId } : {}),
        // "model" → "none" tells the server to skip the coding CLI for this role.
        ...(cfg.tool ? { tool: cfg.tool === "model" ? "none" : cfg.tool } : {}),
        ...(cfg.displayName.trim() ? { displayName: cfg.displayName.trim() } : {}),
        ...(cfg.persona.trim() ? { persona: cfg.persona.trim() } : {}),
      };
    }
```

- [ ] **Step 4: Render include checkbox + Customize panel per role**

In `TeamForm`'s JSX, replace the whole role-map block:

```tsx
        {ROLES.map((r) => (
          <div key={r.role} style={roleRow}>
            <div style={{ width: 130 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</div>
              <div style={{ fontSize: 10, color: "rgb(var(--muted))" }}>{r.blurb}</div>
            </div>
            <div style={{ flex: 1 }}>
              <ModelSelect
                models={settings.models}
                kind="chat"
                value={roles[r.role].modelId}
                onChange={(v) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], modelId: v } }))}
              />
            </div>
            {r.defaultTool && (
              <select
                value={roles[r.role].tool}
                onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], tool: e.target.value as ToolChoice } }))}
                style={{ ...input, width: 120 }}
              >
                <option value="model">model only</option>
                {CODING_TOOLS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
        ))}
```

with:

```tsx
        {ROLES.map((r) => {
          const rc = roles[r.role];
          const on = r.optional ? rc.enabled : true;
          return (
            <div key={r.role} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: on ? 1 : 0.55 }}>
              <div style={roleRow}>
                <div style={{ width: 150, display: "flex", alignItems: "center", gap: 6 }}>
                  {r.optional && (
                    <input
                      type="checkbox"
                      checked={rc.enabled}
                      title={`Include the ${r.label}`}
                      onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], enabled: e.target.checked } }))}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: "rgb(var(--muted))" }}>{r.blurb}</div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <ModelSelect
                    models={settings.models}
                    kind="chat"
                    value={rc.modelId}
                    onChange={(v) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], modelId: v } }))}
                  />
                </div>
                {r.defaultTool && (
                  <select
                    value={rc.tool}
                    disabled={!on}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], tool: e.target.value as ToolChoice } }))}
                    style={{ ...input, width: 150 }}
                  >
                    <option value="model">normal agent (no CLI)</option>
                    {CODING_TOOLS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: "4px 8px" }}
                  disabled={!on}
                  onClick={() => setExpanded((s) => ({ ...s, [r.role]: !s[r.role] }))}
                >
                  {expanded[r.role] ? "Hide" : "Customize"}
                </button>
              </div>
              {on && expanded[r.role] && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
                  <input
                    placeholder={`Display name (default: ${r.label})`}
                    value={rc.displayName}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], displayName: e.target.value } }))}
                    style={{ ...input, width: "100%" }}
                  />
                  <textarea
                    placeholder="Custom persona (blank = use this role's default)"
                    value={rc.persona}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], persona: e.target.value } }))}
                    rows={3}
                    style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                  />
                </div>
              )}
            </div>
          );
        })}
```

- [ ] **Step 5: Update the helper text label**

In `TeamForm`'s helper `<p>` paragraph, change the words `model only` to
`normal agent (no CLI)`:

Find: `Pick <strong>model only</strong> to have a coding role work directly with just its model —`
Replace with: `Pick <strong>normal agent (no CLI)</strong> to have a coding role work directly with just its model —`

- [ ] **Step 6: Build the web app**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds (tsc + vite, exit 0). If it errors that `ghostBtn` is not
defined, confirm the existing style consts at the bottom of the file include
`ghostBtn` (the Cancel button uses it) — it should already exist.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/agents/AgentWizard.tsx
git commit -m "Wizard: skip optional roles, per-role customize, clearer no-CLI option"
```

---

## Task 6: Full verification + push

- [ ] **Step 1: Build both packages**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/web build`
Expected: both exit 0.

- [ ] **Step 2: Run the server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke (optional, requires a running instance)**

`pnpm dev`, open "New coding team", uncheck Test Writer + Tester, set Coder to
"normal agent (no CLI)", give Security Reviewer a custom name via Customize, and
create. Confirm only PM/coder/security agents exist with the chosen name, and a
pipeline run executes `coder → security-reviewer` with no test-writer/tester
stage and no error.

- [ ] **Step 4: Push**

```bash
git push origin dev
```

---

## Notes for the implementer

- `enabled` semantics: omitted = provisioned (back-compat). The wizard sends an
  explicit `enabled` for every role; pm/coder are forced on server-side regardless.
- Don't unit-test the live pipeline-run-over-bus or git/VM path; the convention
  here (see prior features) is unit tests at the pipeline-manager and orchestrator
  layers plus build + manual smoke.
- `rc` in `provisionProjectTeam` is the existing `config[spec.role] ?? {}` — reuse
  it; don't shadow or redefine it.
