# Add agents to a project (with read/write access) — design

## Context

A project in otterbot is a shared git working tree with a provisioned specialist
team (pm, coder, security-reviewer, test-writer, tester). Those team agents are
recorded in `project_members` and get the tree bound, **writable**, into their
sandbox at `/project`.

The user wants to add **other existing agents** to a project — e.g. a Discord
support bot that answers questions about a specific project's code and therefore
needs to read all of its source. Such an agent should get source access without
being a pipeline role, and (by default) should **not** be able to modify the
tree.

Most of the backend already exists: `ProjectStore.addMember/removeMember`,
`Orchestrator.addProjectMember/removeProjectMember`, and the
`POST/DELETE /api/projects/:id/members` routes. Membership already drives the
`/project` sandbox bind **live** via the `projectRepoPath` thunk (no agent
restart needed — `repoPathForAgent` is queried on each `shell_exec`). The gaps
are: (1) no per-member access level (everything is writable), and (2) no UI to
add/remove arbitrary members.

**Decisions (confirmed with user):**
- **Read-only by default, writable opt-in.** Added members get `read` access;
  the user can switch a member to `write`. The provisioned team is `write`.
- **Separate "Additional agents" UI section** on the project card. Team-role
  chips stay as-is and are not managed there (avoids breaking the pipeline).
- Read-only is enforced on **Linux/bwrap** via `--ro-bind`. macOS `sandbox-exec`
  read-only is a follow-up (this deployment is Linux).

**Important nuance (not a code change here):** an agent only *reads* `/project`
through its shell / code tools. A support bot must have `shell_exec` (or a
code-search capability) enabled on its own profile to use the source. Membership
binds the tree; it does not grant tools.

## Architecture

The change threads a per-member `access` value (`'read' | 'write'`) from a new
`project_members` column → the project store → a live `projectAccess` thunk on
the agent context → the sandbox bind (`--ro-bind` vs `--bind`). The API and web
layers gain the ability to set access and add/remove arbitrary members. It
reuses the existing membership plumbing and the thunk pattern already used for
`projectRepoPath`/`projectRules`.

### 1. Data model

Add an `access` column to `project_members`.

- `packages/server/src/db/control-db.ts` — add `access TEXT NOT NULL DEFAULT 'read'`
  to the `CREATE TABLE IF NOT EXISTS project_members (...)` statement, and an
  idempotent migration (`PRAGMA table_info(project_members)` guard +
  `ALTER TABLE project_members ADD COLUMN access TEXT NOT NULL DEFAULT 'read'`),
  following the existing `addProjectCol`-style migration pattern.
- `packages/server/src/db/control-schema.ts` — add
  `access: text("access", { enum: ["read", "write"] }).notNull().default("read")`
  to the `projectMembers` table.

`'read'` default is correct for both pre-existing rows and newly-added agents.

### 2. Server — store

In `packages/server/src/projects/project-store.ts`:
- `addMember(projectId, agentId, access: "read" | "write" = "read"): void` —
  add the `access` param; keep `onConflictDoUpdate` (or keep
  `onConflictDoNothing` but set access on insert; existing membership keeps its
  access). Spec: on conflict, update `access` to the passed value so re-adding a
  team agent as `write` is deterministic.
- `setMemberAccess(projectId, agentId, access): void` — update the row's access.
- `listMembersDetailed(projectId): Array<{ agentId: string; access: "read" | "write" }>` —
  for the API payload. Keep the existing `listMembers(): string[]` for callers
  that only need ids.
- `accessForAgent(agentId): "read" | "write" | null` — the access on the
  membership row of the agent's most-recent project (the same project
  `repoPathForAgent` resolves, so source path and access stay consistent).
  Returns `null` when the agent is in no project.

### 3. Server — agent context + sandbox (read-only enforcement)

- `packages/server/src/runtime/agent-context.ts` — add a thunk
  `projectAccess: () => "read" | "write" | null` to `AgentContext`, plus a
  `resolveProjectAccess?` input, mirroring `projectRepoPath`/`projectRules`.
- `packages/server/src/orchestrator/orchestrator.ts` — in the
  `buildAgentContext({...})` call (~line 1065), wire
  `resolveProjectAccess: () => this.projects.accessForAgent(profile.id)`.
- `packages/server/src/integrations/shell.ts` — add `projectReadOnly?: boolean`
  to `SandboxOptions`. At the bwrap project bind (currently
  `args.push("--bind", opts.projectRepoPath, PROJECT_MOUNT)`, ~line 205-206),
  use `--ro-bind` when `opts.projectReadOnly` is true. Thread the flag through
  `runAgentShell(..., opts)` (~line 343) into `buildSandboxPlan`. (macOS
  `sandbox-exec` branch: leave as-is for now; note the read-only limitation.)
- `packages/server/src/agent/tools.ts` — at the `shell_exec` call (~line 561)
  pass `projectReadOnly: ctx.projectAccess() === "read"`. In the write-oriented
  tools that touch `/project` — `git_commit` (~line 618) and the coding-CLI tool
  — refuse with a clear message when `ctx.projectAccess() === "read"` (so a
  read-only member gets an explicit error rather than an opaque write failure).

### 4. Server — API

In `packages/server/src/server.ts`:
- `POST /api/projects/:id/members` — body gains optional
  `access?: "read" | "write"` (default `"read"`); pass to `addProjectMember`.
- New `PATCH /api/projects/:id/members/:agentId` with body `{ access }` →
  `orch.setProjectMemberAccess(projectId, agentId, access)`.
- `Orchestrator.addProjectMember(projectId, agentId, access = "read")` gains the
  param; new `Orchestrator.setProjectMemberAccess(projectId, agentId, access)`.
- `provisionProjectTeam` (~line 1665) — call `addMember(projectId, id, "write")`
  so team roles are writable.
- `listProjects()` (~line 1298) — change each project's `members` from
  `string[]` to `listMembersDetailed(...)` → `Array<{ agentId, access }>`.

### 5. Web

- `packages/web/src/stores/projects-store.ts`:
  - `Project.members` type changes from `string[]` to
    `Array<{ agentId: string; access: "read" | "write" }>`.
  - `addMember(projectId, agentId, access?: "read" | "write")` — include access
    in the POST body.
  - new `setMemberAccess(projectId, agentId, access)` action → `PATCH`.
- `packages/web/src/components/agents/AgentRoster.tsx` — the only consumer of
  `project.members` (the project-grouping loop, ~line 83
  `for (const memberId of p.members)`). Update it to read `m.agentId` from the
  new object shape.
- `packages/web/src/components/agents/ProjectsView.tsx` — in `ProjectCard`, add
  an **"Additional agents"** section below the team chips:
  - An add-agent picker (a `<select>` + Add button, or a small dropdown) listing
    agents from `useAgentsStore` filtered to: `role !== "subagent"` and not
    already a member of this project.
  - A list of the **non-team** members (members whose `agentId` is not in
    `project.team`), each row showing the agent name, an access `<select>`
    (read-only / read-write) wired to `setMemberAccess`, and a remove (✕) button
    wired to `removeMember`.

### 6. Testing

- **Server (vitest, `project-store.test.ts`):** `addMember` defaults to `read`;
  `addMember(..., "write")` and `setMemberAccess` round-trip; `accessForAgent`
  returns the right value and `null` for non-members; most-recent-project wins
  consistently with `repoPathForAgent`.
- **Server (`shell.test.ts` or a focused test of `buildSandboxPlan`):** with
  `projectReadOnly: true` the plan binds `/project` with `--ro-bind`; with
  `false`/absent it uses `--bind`.
- **Web:** build/type-check clean. Manual smoke: add an existing agent to a
  project, see it in "Additional agents" as read-only, toggle to read-write,
  remove it.

## Out of scope

- Project-scoped Discord wiring — a support bot is just an agent that already has
  Discord configured; this feature only gives it source access.
- Granting tools to the added agent (it still needs `shell_exec` / code-search on
  its own profile to read the source).
- macOS `sandbox-exec` read-only enforcement (Linux/bwrap first).
- Read/write access for any mount other than `/project`.

## Verification

1. `pnpm --filter @otterbot/server build` and `pnpm --filter @otterbot/web build`
   compile clean.
2. `pnpm --filter @otterbot/server test` — store + sandbox-plan tests pass.
3. `pnpm dev`: open a project card → "Additional agents" → add an existing agent
   (e.g. a Discord support bot). Confirm it appears as read-only. Have that agent
   run a `shell_exec` like `ls /project` / `cat` a source file and confirm it can
   read; confirm a write (`touch /project/x`) fails under read-only and succeeds
   after switching the member to read-write. Remove the member and confirm
   `/project` is no longer bound on its next command.
