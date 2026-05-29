# Project rules — design

## Context

Each coding **project** in otterbot gets a dedicated team of agents (pm, coder,
security-reviewer, test-writer, tester) that share one git working tree. Today
the only per-project knobs are the forge "code location" settings (mode, repo,
base branch). There's no way to give a project's team standing guidance —
things like "always commit to dev", house coding standards, or conventions the
user wants every team member to follow.

This feature adds a freeform **project rules** text block. The user edits it per
project, and it is injected into every project member's system prompt as a
`## Project rules` section, so the team reads and follows it like instructions.

**Decisions (confirmed with user):**
- **Advisory, not enforced.** Rules are prompt-injected guidance, not mechanical
  enforcement. Branch targeting and similar already live in the forge config.
- **Editable in two places:** an editor on each project card *and* a field in the
  "New coding team" wizard to seed rules at creation.
- **Applies to all project members** — the provisioned team roles and any agent
  manually added to the project, not just the coding roles.
- Freeform text (markdown), no structured rule builder (YAGNI).

## Architecture

The feature follows the existing forge-config pattern end to end: a new nullable
column on `projects`, a targeted store setter, an orchestrator method, a `PUT`
route, a web store action, and a card editor. The one genuinely new piece is the
prompt-injection path, which reuses the thunk mechanism already used to bind the
`/project` repo path into an agent's context.

### 1. Data model

Add a nullable `rules` column to the `projects` table.

- `packages/server/src/db/control-db.ts` — add `rules TEXT` to the
  `CREATE TABLE IF NOT EXISTS projects (...)` statement, and add an idempotent
  migration so existing databases gain the column. Follow the migration style
  already used in this file (a guarded `ALTER TABLE projects ADD COLUMN rules TEXT`
  that ignores the "duplicate column" error).
- `packages/server/src/db/control-schema.ts` — add `rules: text("rules")` to the
  Drizzle `projects` table definition (nullable).
- `packages/server/src/projects/project-store.ts` — add `rules: string | null` to
  the `Project` interface, and ensure the row-mapping in `get()`/`list()` carries
  it through.
- `packages/web/src/stores/projects-store.ts` — add `rules: string | null` to the
  web `Project` interface.

### 2. Server — store, orchestrator, API

- **`ProjectStore.setRules(projectId, rules: string | null): void`** — a single
  `UPDATE projects SET rules = ?`, mirroring `setForge` (project-store.ts ~91–102).
- **`ProjectStore.rulesForAgent(agentId): string | null`** — resolve the agent's
  project via the existing `projectsForAgent(agentId)` (most-recently-joined wins,
  exactly like `repoPathForAgent`, project-store.ts ~188–190) and return that
  project's `rules`. Returns `null` when the agent belongs to no project.
- **`Orchestrator.setProjectRules(projectId, rules): void`** — delegates to
  `this.projects.setRules(...)` (orchestrator.ts, near `setProjectForge` ~1403).
- **Route `PUT /api/projects/:id/rules`** (server.ts, beside the existing
  `PUT /api/projects/:id/forge` ~449) — body `{ rules?: string | null }`, calls
  `orch.setProjectRules(id, rules ?? null)`, returns the updated project (or
  `listProjects()` entry).
- **`POST /api/projects`** (server.ts ~303–320) — accept an optional `rules`
  field in the body; after `createProject(name)` (and before/after
  `provisionProjectTeam`), call `orch.setProjectRules(project.id, rules)` when
  provided.
- `listProjects()` already spreads project fields, so `rules` reaches
  `GET /api/projects` with no change.

### 3. Server — prompt injection (the behavior)

- **`AgentContext`** (`runtime/agent-context.ts`) gains a thunk
  `projectRules: () => string | null`, set up the same way as the existing
  `projectRepoPath` thunk (~line 56 / ~174). `buildAgentContext` takes a new
  `resolveProjectRules` arg.
- **`buildAgentContext` call site** (`orchestrator.ts` ~1057–1074) wires
  `resolveProjectRules: () => this.projects.rulesForAgent(profile.id)` right
  beside the existing `resolveProjectRepoPath`.
- **`buildSystemPrompt`** (`agent/prompt.ts` ~79–144): after the persona and
  `OPERATING_GUIDE` are pushed into `parts`, read `ctx.projectRules()`; if it is
  non-empty (after trim), `parts.push(\`## Project rules\n\n${rules.trim()}\`)`.
  Because the thunk is read each turn, edits to a project's rules take effect on
  the next turn without rebuilding the context.

### 4. Web UI

- **`projects-store.ts`** — add `rules` to the `Project` type; add
  `setRules(projectId: string, rules: string): Promise<void>` that `PUT`s to
  `/api/projects/${id}/rules` and updates local state (mirroring `setForge`);
  include `rules` in the `create` payload path used by the wizard.
- **`ProjectsView.tsx` `ProjectCard`** — add a "Project rules" section below the
  forge "Code location" block: a `<textarea>` seeded from `project.rules ?? ""`
  held in local form state, plus a Save button that calls `setRules` and shows a
  busy state — the same form-state/save shape as the forge form (~72–151).
- **`AgentWizard.tsx`** team flow (`initialChoice="team"`, ~100–191) — add a
  rules `<textarea>` whose trimmed value is included in the `POST /api/projects`
  body alongside `name` and `team`.

### 5. Testing

- **Server (vitest):**
  - `ProjectStore.setRules` / `rulesForAgent` round-trip: create a project, set
    rules, add an agent as a member, assert `rulesForAgent(agentId)` returns the
    text; assert `null` for a non-member.
  - `buildSystemPrompt` includes a `## Project rules` block when
    `ctx.projectRules()` returns text, and omits it when it returns `null`/empty.
- **Web (playwright):** enter rules on a project card, save, reload, and confirm
  the textarea still shows the saved text. (Runs against the self-contained fake
  model; gate appropriately if the seeded data dir is required.)

## Out of scope

- Mechanical enforcement of rules (git hooks, branch protection, lint gates).
- Instance-wide / global rules shared across all projects.
- Per-role rule overrides (all members of a project get the same rules).
- Versioning or history of rules edits.

## Verification

1. `pnpm --filter @otterbot/server build` and `pnpm --filter @otterbot/web build`
   compile clean.
2. `pnpm --filter @otterbot/server test` — new store + prompt tests pass.
3. `pnpm dev`: create a coding team in the wizard with rules text → open the
   project card and confirm the rules show and are editable/saveable → start a
   pipeline (or chat with a team member) and confirm the agent's behavior
   reflects the rules. Confirm a project with no rules produces no
   `## Project rules` section.
