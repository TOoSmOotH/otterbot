# Project Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set a freeform per-project "rules" text that is injected into every project team member's system prompt as a `## Project rules` section.

**Architecture:** Add a nullable `rules` column to the `projects` table and a `ProjectStore.setRules`/`rulesForAgent` pair. Wire a `projectRules` thunk into `AgentContext` (mirroring the existing `projectRepoPath` thunk) so `buildSystemPrompt` can append the rules each turn. Expose editing via a `PUT /api/projects/:id/rules` route plus a card editor and a wizard field on the web side.

**Tech Stack:** TypeScript, better-sqlite3 + Drizzle (server), Fastify, React + Zustand (web), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-28-project-rules-design.md`

**Conventions:**
- Run server tests with `pnpm --filter @otterbot/server test`.
- Per the repo's commit convention, commit messages do NOT include `Co-Authored-By` trailers.
- Work happens on the `dev` branch.

---

### Task 1: Persist project rules (schema + store)

**Files:**
- Modify: `packages/server/src/projects/project-store.ts` (Project interface ~20-38; add methods near `setForge` ~91-102)
- Modify: `packages/server/src/db/control-schema.ts` (`projects` table ~121-141)
- Modify: `packages/server/src/db/control-db.ts` (`CREATE TABLE ... projects` ~91-101; migration block ~170-183)
- Test: `packages/server/src/projects/project-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the `describe("ProjectStore", ...)` block in `packages/server/src/projects/project-store.test.ts` (e.g. after the "defaults to local mode" test ~line 83):

```ts
  it("stores and clears project rules", () => {
    const p = store.create("Ruled");
    expect(p.rules).toBeNull();
    store.setRules(p.id, "Always commit to dev.\nWrite tests first.");
    expect(store.get(p.id)!.rules).toBe("Always commit to dev.\nWrite tests first.");
    store.setRules(p.id, null);
    expect(store.get(p.id)!.rules).toBeNull();
  });

  it("resolves rules for an agent via project membership (most recent wins)", () => {
    const p = store.create("Ruled");
    store.setRules(p.id, "House style applies.");
    store.addMember(p.id, "coder");
    expect(store.rulesForAgent("coder")).toBe("House style applies.");
    expect(store.rulesForAgent("stranger")).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @otterbot/server test project-store`
Expected: FAIL — TypeScript errors that `rules` does not exist on `Project` and `setRules`/`rulesForAgent` do not exist on `ProjectStore`.

- [ ] **Step 3: Add the `rules` column to the Drizzle schema**

In `packages/server/src/db/control-schema.ts`, inside the `projects = sqliteTable("projects", { ... })` definition, add a `rules` field immediately after the `monitorIssues` line and before `createdAt`:

```ts
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: integer("monitor_issues", { mode: "boolean" }).notNull().default(false),
  /** Standing rules injected into every project member's system prompt. */
  rules: text("rules"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
```

- [ ] **Step 4: Add the column to the raw DDL and migration**

In `packages/server/src/db/control-db.ts`, add a `rules TEXT` line to the `CREATE TABLE IF NOT EXISTS projects (...)` statement (after `monitor_issues`):

```sql
      monitor_issues INTEGER NOT NULL DEFAULT 0,
      rules TEXT,
      created_at TEXT NOT NULL
```

Then, in the projects migration block (the `addProjectCol(...)` calls ~178-183), add one more line so existing databases gain the column:

```ts
  addProjectCol("monitor_issues", "monitor_issues INTEGER NOT NULL DEFAULT 0");
  addProjectCol("rules", "rules TEXT");
```

- [ ] **Step 5: Add `rules` to the `Project` interface and the store methods**

In `packages/server/src/projects/project-store.ts`, add `rules` to the `Project` interface, after `monitorIssues` and before `createdAt`:

```ts
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: boolean;
  /** Standing rules injected into every project member's system prompt. */
  rules: string | null;
  createdAt: string;
```

Then add two methods immediately after `setForge` (after line ~102):

```ts
  /** Set (or clear, with null) the project's standing rules. */
  setRules(projectId: string, rules: string | null): void {
    this.control.db
      .update(controlSchema.projects)
      .set({ rules })
      .where(eq(controlSchema.projects.id, projectId))
      .run();
  }

  /**
   * The standing rules for the agent's project, or null. Like
   * {@link repoPathForAgent}, the most recently created project wins when the
   * agent is in several.
   */
  rulesForAgent(agentId: string): string | null {
    return this.projectsForAgent(agentId)[0]?.rules ?? null;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @otterbot/server test project-store`
Expected: PASS (all ProjectStore tests, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/projects/project-store.ts packages/server/src/projects/project-store.test.ts packages/server/src/db/control-schema.ts packages/server/src/db/control-db.ts
git commit -m "feat(projects): persist per-project rules (schema + store)"
```

---

### Task 2: Expose project rules to the agent context

**Files:**
- Modify: `packages/server/src/runtime/agent-context.ts` (`AgentContext` ~56; `BuildAgentContextInput` ~108; `buildAgentContext` ~174)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`buildAgentContext` call ~1057-1074)

This task is runtime plumbing; it is verified by a clean compile (the consumption is tested in Task 3).

- [ ] **Step 1: Add the `projectRules` thunk to the context interfaces**

In `packages/server/src/runtime/agent-context.ts`, add to the `AgentContext` interface, right after the `projectRepoPath` field (~line 56):

```ts
  /**
   * The shared project working tree bound into this agent's sandbox at
   * `/project`, or null when the agent belongs to no project. A thunk so
   * membership changes take effect without rebuilding the context.
   */
  projectRepoPath: () => string | null;
  /**
   * The standing rules for this agent's project, or null when it belongs to no
   * project (or the project has none). A thunk so rule edits take effect on the
   * next turn without rebuilding the context.
   */
  projectRules: () => string | null;
```

Add to the `BuildAgentContextInput` interface, right after `resolveProjectRepoPath` (~line 108):

```ts
  /**
   * Resolve the shared project tree bound into this agent's sandbox, or null
   * when it belongs to no project. Called live (membership can change).
   */
  resolveProjectRepoPath?: () => string | null;
  /**
   * Resolve the standing rules for this agent's project, or null. Called live
   * (rules can change between turns).
   */
  resolveProjectRules?: () => string | null;
```

- [ ] **Step 2: Wire the thunk into the constructed context**

In the same file, in `buildAgentContext`, add to the `ctx` object literal right after the `projectRepoPath` assignment (~line 174):

```ts
    projectRepoPath: input.resolveProjectRepoPath ?? (() => null),
    projectRules: input.resolveProjectRules ?? (() => null),
```

- [ ] **Step 3: Pass the resolver from the orchestrator**

In `packages/server/src/orchestrator/orchestrator.ts`, in the `buildAgentContext({ ... })` call (~line 1065), add the resolver immediately after `resolveProjectRepoPath`:

```ts
      resolveProjectRepoPath: () => this.projects.repoPathForAgent(profile.id),
      resolveProjectRules: () => this.projects.rulesForAgent(profile.id),
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/runtime/agent-context.ts packages/server/src/orchestrator/orchestrator.ts
git commit -m "feat(projects): expose project rules via the agent context thunk"
```

---

### Task 3: Inject project rules into the system prompt

**Files:**
- Modify: `packages/server/src/agent/prompt.ts` (`buildSystemPrompt` ~79-80)
- Test: `packages/server/src/agent/prompt.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/agent/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentContext } from "../runtime/agent-context.js";
import { buildSystemPrompt } from "./prompt.js";

/**
 * A minimal stub context exercising only the members buildSystemPrompt reads:
 * profile.persona, memory.searchContent, skills.{listEnabled,get,recordUse},
 * userProfile.renderForPrompt, secrets, and the new projectRules thunk.
 */
function makeCtx(opts: { projectRules: string | null }): AgentContext {
  return {
    profile: { persona: "You are a helpful agent." },
    secrets: new Map<string, string>(),
    memory: { searchContent: async () => [] },
    skills: { listEnabled: () => [], get: () => null, recordUse: () => {} },
    userProfile: { renderForPrompt: () => "" },
    projectRepoPath: () => null,
    projectRules: () => opts.projectRules,
  } as unknown as AgentContext;
}

describe("buildSystemPrompt — project rules", () => {
  it("injects a Project rules section when the agent's project has rules", async () => {
    const ctx = makeCtx({ projectRules: "Always commit to dev." });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).toContain("## Project rules");
    expect(system).toContain("Always commit to dev.");
  });

  it("omits the section when there are no rules", async () => {
    const ctx = makeCtx({ projectRules: null });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).not.toContain("## Project rules");
  });

  it("omits the section when rules are only whitespace", async () => {
    const ctx = makeCtx({ projectRules: "   \n  " });
    const { system } = await buildSystemPrompt(ctx, { userMessage: "hi" });
    expect(system).not.toContain("## Project rules");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @otterbot/server test prompt`
Expected: FAIL — the first test fails because no `## Project rules` section is emitted.

- [ ] **Step 3: Add the injection to `buildSystemPrompt`**

In `packages/server/src/agent/prompt.ts`, find this line (~80):

```ts
  const persona = ctx.profile.persona.trim() || FALLBACK_PERSONA;
  const parts: string[] = [persona, OPERATING_GUIDE];
```

Insert the rules block immediately after it (before the `if (args.peers ...)` block):

```ts
  const persona = ctx.profile.persona.trim() || FALLBACK_PERSONA;
  const parts: string[] = [persona, OPERATING_GUIDE];

  const projectRules = ctx.projectRules()?.trim();
  if (projectRules) {
    parts.push(
      `## Project rules\n\nStanding rules for this project — follow them in everything you do here:\n\n${projectRules}`
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @otterbot/server test prompt`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agent/prompt.ts packages/server/src/agent/prompt.test.ts
git commit -m "feat(projects): inject project rules into the system prompt"
```

---

### Task 4: Server API — orchestrator method, PUT route, create payload

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (near `createProject` ~1311-1319)
- Modify: `packages/server/src/server.ts` (POST `/api/projects` ~303-320; add PUT `/api/projects/:id/rules` after the forge route ~466)

- [ ] **Step 1: Add `setProjectRules` to the orchestrator**

In `packages/server/src/orchestrator/orchestrator.ts`, add this method right after `createProject` (~line 1319):

```ts
  /** Set (or clear, with null) a project's standing rules. */
  setProjectRules(projectId: string, rules: string | null): void {
    this.projects.setRules(projectId, rules);
  }
```

- [ ] **Step 2: Accept `rules` when creating a project**

In `packages/server/src/server.ts`, update the POST `/api/projects` handler (~303-320). Change the `Body` type and persist rules after create:

```ts
  app.post<{
    Body: {
      name?: string;
      team?: Record<string, { modelId?: string; tool?: string }>;
      rules?: string;
    };
  }>("/api/projects", async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) {
      reply.code(400);
      return { error: "name is required" };
    }
    try {
      const project = orch.createProject(name);
      const rules = req.body?.rules?.trim() || null;
      if (rules) orch.setProjectRules(project.id, rules);
      // The wizard may provision a customized team in the same call.
      if (req.body?.team) orch.provisionProjectTeam(project.id, req.body.team);
      return { ...project, rules, team: orch.getProjectTeam(project.id) };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
```

- [ ] **Step 3: Add the PUT rules route**

In `packages/server/src/server.ts`, add this route immediately after the `PUT /api/projects/:id/forge` handler (after ~line 466):

```ts
  // Set (or clear) a project's standing rules, injected into members' prompts.
  app.put<{
    Params: { id: string };
    Body: { rules?: string | null };
  }>("/api/projects/:id/rules", async (req) => {
    const rules = (req.body?.rules ?? "").trim() || null;
    orch.setProjectRules(req.params.id, rules);
    return { ok: true, rules };
  });
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts packages/server/src/server.ts
git commit -m "feat(projects): API to set project rules (PUT route + create payload)"
```

---

### Task 5: Web store — Project type, setRules action

**Files:**
- Modify: `packages/web/src/stores/projects-store.ts` (`Project` interface ~5-17; `ProjectsState` ~56-97; actions ~197-211)

- [ ] **Step 1: Add `rules` to the web `Project` type**

In `packages/web/src/stores/projects-store.ts`, add `rules` to the `Project` interface (after `monitorIssues`):

```ts
  baseBranch: string | null;
  monitorIssues: boolean;
  rules: string | null;
}
```

- [ ] **Step 2: Declare the `setRules` action on the state interface**

In the `ProjectsState` interface, add this signature right after the `setForge` signature (~line 95):

```ts
  setRules: (projectId: string, rules: string) => Promise<string | null>;
```

- [ ] **Step 3: Implement the `setRules` action**

In the store object, add this action right after the `setForge` implementation (~line 211):

```ts
  setRules: async (projectId, rules) => {
    const res = await apiFetch(`/api/projects/${projectId}/rules`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rules }),
    });
    if (!res.ok) {
      const err = await readError(res);
      set({ error: err });
      return err;
    }
    set({ error: null });
    await get().load();
    return null;
  },
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/projects-store.ts
git commit -m "feat(web): projects store rules field + setRules action"
```

---

### Task 6: Web UI — rules editor on the project card

**Files:**
- Modify: `packages/web/src/components/agents/ProjectsView.tsx` (`ProjectCard` — store selectors ~62-71, form state ~72-80, render after forge save button ~154)

- [ ] **Step 1: Select the `setRules` action and add form state**

In `packages/web/src/components/agents/ProjectsView.tsx`, inside `ProjectCard`, add a store selector next to the existing ones (the `startPipeline`/`setForge` selectors ~67-70):

```ts
  const setForge = useProjectsStore((s) => s.setForge);
  const setRules = useProjectsStore((s) => s.setRules);
  const startPipeline = useProjectsStore((s) => s.startPipeline);
```

Then add local state next to the other `useState` hooks (~72-80):

```ts
  const [rulesText, setRulesText] = useState(project.rules ?? "");
  const [rulesBusy, setRulesBusy] = useState(false);
```

- [ ] **Step 2: Render the rules editor**

In the same component's JSX, insert this block immediately after the "Save code location" button's closing `</button>` (~line 154) and before the `{/* Pipeline */}` comment:

```tsx
      {/* Project rules */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Project rules</div>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", margin: "2px 0 6px" }}>
        Standing instructions for every team member — e.g. "always commit to dev", coding standards.
      </p>
      <textarea
        data-testid={`project-rules-${project.id}`}
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
        placeholder="One rule per line…"
        rows={5}
        style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
      />
      <button
        style={{ ...ghostBtn, marginTop: 6 }}
        disabled={rulesBusy}
        onClick={async () => {
          setRulesBusy(true);
          await setRules(project.id, rulesText);
          setRulesBusy(false);
        }}
      >
        {rulesBusy ? "Saving…" : "Save rules"}
      </button>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/agents/ProjectsView.tsx
git commit -m "feat(web): project rules editor on the project card"
```

---

### Task 7: Web UI — rules field in the new-team wizard

**Files:**
- Modify: `packages/web/src/components/agents/AgentWizard.tsx` (`TeamForm` — state ~105-110, `create` POST body ~117-133, render before the action buttons ~186)

- [ ] **Step 1: Add rules state to `TeamForm`**

In `packages/web/src/components/agents/AgentWizard.tsx`, inside `TeamForm`, add a state hook next to the existing `useState` calls (~105-107):

```ts
  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
```

- [ ] **Step 2: Include rules in the create POST body**

In the same `create` function, update the POST body to include rules when non-empty (~131-133):

```ts
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        team,
        ...(rules.trim() ? { rules: rules.trim() } : {}),
      }),
    });
```

- [ ] **Step 3: Render a rules textarea**

In `TeamForm`'s JSX, insert this block right after the closing `</div>` of the roles list and before the explanatory `<p>` (the paragraph beginning "Each coding role uses its own subscription…", ~line 185):

```tsx
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Project rules (optional)</div>
        <textarea
          data-testid="team-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder={`Standing rules for the team — e.g.\nAlways commit to dev.\nFollow the existing code style.`}
          rows={4}
          style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/AgentWizard.tsx
git commit -m "feat(web): seed project rules from the new-team wizard"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Server build + full test suite**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/server test`
Expected: PASS — including the new `project-store` and `prompt` tests.

- [ ] **Step 2: Web build**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (clean compile).

- [ ] **Step 3: Manual smoke test**

Run `pnpm dev`, then in the UI:
- Projects → "New coding team": create a team and enter rules text (e.g. "Always commit to dev.") in the new field. Create.
- Open the new project's card: confirm the "Project rules" textarea shows the saved text. Edit it, click "Save rules", reload the page, and confirm the change persisted.
- Chat with a team member (e.g. the coder) and confirm its behavior reflects the rules (or inspect the assembled system prompt in server logs if available) — it should contain a `## Project rules` section.
- Confirm a project with empty rules produces no `## Project rules` section (a non-team standalone agent never gets one).

- [ ] **Step 4: Push**

```bash
git push origin dev
```

---

## Notes / decisions captured from the spec

- **Advisory only.** Rules are prompt-injected guidance; there is no mechanical enforcement (out of scope).
- **Applies to all project members** — the provisioned team roles and any manually-added member — because `rulesForAgent` resolves via project membership, exactly like `repoPathForAgent`.
- **Most-recent project wins** when an agent is in multiple projects (Phase-1 single-project binding, consistent with `repoPathForAgent`).
- **Creation-time rules** flow through the wizard's existing direct `POST /api/projects` (not the store's `create` action, which stays name-only).
- **Read fresh each turn** via the thunk, so edits take effect on the next turn without rebuilding the agent context.
