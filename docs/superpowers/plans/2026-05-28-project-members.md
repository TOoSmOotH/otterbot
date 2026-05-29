# Add Agents to a Project (read/write access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add any existing agent (e.g. a Discord support bot) to a project as a member with read-only (default) or read-write access to the project's `/project` source tree, managed from the project card.

**Architecture:** Add an `access` column to `project_members`; thread it from the store through a live `projectAccess` thunk on the agent context into the sandbox bind (`--ro-bind` vs `--bind`). Add API + web-store + project-card UI to add/remove members and toggle access. Reuses the existing membership plumbing and the `projectRepoPath`/`projectRules` thunk pattern.

**Tech Stack:** TypeScript, better-sqlite3 + Drizzle (server), Fastify, bubblewrap (`bwrap`) sandbox, React + Zustand (web), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-28-project-members-design.md`

**Conventions:**
- Run server tests: `pnpm --filter @otterbot/server test <name>`.
- Commit messages must NOT include any `Co-Authored-By` trailer.
- Work on the `dev` branch.

---

### Task 1: Per-member access (schema + store)

**Files:**
- Modify: `packages/server/src/db/control-db.ts` (`CREATE TABLE ... project_members` ~115-120; add a migration after the projects migration block ~183)
- Modify: `packages/server/src/db/control-schema.ts` (`projectMembers` table ~144-150)
- Modify: `packages/server/src/projects/project-store.ts` (`addMember` ~158-166; add methods after `removeMember`/`listMembers`)
- Test: `packages/server/src/projects/project-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe("ProjectStore", ...)` block in `packages/server/src/projects/project-store.test.ts` (after the "manages membership idempotently" test ~line 50):

```ts
  it("adds members read-only by default and resolves access", () => {
    const p = store.create("Acc");
    store.addMember(p.id, "bot");
    expect(store.listMembersDetailed(p.id)).toEqual([{ agentId: "bot", access: "read" }]);
    expect(store.accessForAgent("bot")).toBe("read");
    expect(store.accessForAgent("nobody")).toBeNull();
  });

  it("supports write members, updates access, and re-add overwrites access", () => {
    const p = store.create("Acc");
    store.addMember(p.id, "coder", "write");
    expect(store.accessForAgent("coder")).toBe("write");
    store.setMemberAccess(p.id, "coder", "read");
    expect(store.accessForAgent("coder")).toBe("read");
    store.addMember(p.id, "coder", "write"); // re-add is deterministic
    expect(store.accessForAgent("coder")).toBe("write");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @otterbot/server test project-store`
Expected: FAIL — `listMembersDetailed`, `accessForAgent`, `setMemberAccess` don't exist and `addMember` takes no access arg.

- [ ] **Step 3: Add the `access` column to the raw DDL and a migration**

In `packages/server/src/db/control-db.ts`, add `access TEXT NOT NULL DEFAULT 'read'` to the `CREATE TABLE IF NOT EXISTS project_members (...)` statement (after `created_at`, before the `PRIMARY KEY` line):

```sql
    `CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'read',
      PRIMARY KEY (project_id, agent_id)
    )`,
```

Then add a migration immediately after the projects migration block (after the `addProjectCol("rules", "rules TEXT");` line ~183, before the forge_accounts migration):

```ts
  // Migration: project_members grew a per-member access level ('read'|'write').
  const memberCols = new Set(
    (sqlite.prepare(`PRAGMA table_info(project_members)`).all() as Array<{ name: string }>).map(
      (c) => c.name
    )
  );
  if (!memberCols.has("access")) {
    sqlite.exec(`ALTER TABLE project_members ADD COLUMN access TEXT NOT NULL DEFAULT 'read'`);
  }
```

- [ ] **Step 4: Add the column to the Drizzle schema**

In `packages/server/src/db/control-schema.ts`, add `access` to the `projectMembers` table (after `agentId`, before `createdAt`):

```ts
export const projectMembers = sqliteTable("project_members", {
  projectId: text("project_id").notNull(),
  agentId: text("agent_id").notNull(),
  access: text("access", { enum: ["read", "write"] })
    .notNull()
    .default("read"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
```

- [ ] **Step 5: Update `addMember` and add the new store methods**

In `packages/server/src/projects/project-store.ts`, replace the existing `addMember` method with:

```ts
  /**
   * Add an agent to a project with the given access (default read-only). Re-adding
   * an existing member updates its access deterministically.
   */
  addMember(projectId: string, agentId: string, access: "read" | "write" = "read"): void {
    if (!this.get(projectId)) throw new Error(`Unknown project: ${projectId}`);
    this.control.db
      .insert(controlSchema.projectMembers)
      .values({ projectId, agentId, access, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [controlSchema.projectMembers.projectId, controlSchema.projectMembers.agentId],
        set: { access },
      })
      .run();
  }

  /** Change an existing member's access level. */
  setMemberAccess(projectId: string, agentId: string, access: "read" | "write"): void {
    this.control.db
      .update(controlSchema.projectMembers)
      .set({ access })
      .where(
        and(
          eq(controlSchema.projectMembers.projectId, projectId),
          eq(controlSchema.projectMembers.agentId, agentId)
        )
      )
      .run();
  }
```

Then add these two methods immediately after the existing `listMembers` method (after ~line 188):

```ts
  /** Project members with their per-member access level. */
  listMembersDetailed(projectId: string): Array<{ agentId: string; access: "read" | "write" }> {
    return this.control.db
      .select({
        agentId: controlSchema.projectMembers.agentId,
        access: controlSchema.projectMembers.access,
      })
      .from(controlSchema.projectMembers)
      .where(eq(controlSchema.projectMembers.projectId, projectId))
      .all();
  }

  /**
   * The access level for the agent's project — the membership row of the same
   * project {@link repoPathForAgent} resolves (most recently created wins), or
   * null when the agent belongs to no project.
   */
  accessForAgent(agentId: string): "read" | "write" | null {
    const project = this.projectsForAgent(agentId)[0];
    if (!project) return null;
    return (
      this.control.db
        .select({ access: controlSchema.projectMembers.access })
        .from(controlSchema.projectMembers)
        .where(
          and(
            eq(controlSchema.projectMembers.projectId, project.id),
            eq(controlSchema.projectMembers.agentId, agentId)
          )
        )
        .get()?.access ?? null
    );
  }
```

(`and` and `eq` are already imported at the top of this file.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @otterbot/server test project-store`
Expected: PASS — all ProjectStore tests including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/control-db.ts packages/server/src/db/control-schema.ts packages/server/src/projects/project-store.ts packages/server/src/projects/project-store.test.ts
git commit -m "feat(projects): per-member access level on project_members (schema + store)"
```

---

### Task 2: Read-only project bind in the sandbox

**Files:**
- Modify: `packages/server/src/integrations/shell.ts` (`SandboxOpts` ~120-141; `bwrapPlan` project bind ~205-207; `runAgentShell` opts ~343-352)
- Test: `packages/server/src/integrations/shell.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("buildSandboxPlan project binding", ...)` block in `packages/server/src/integrations/shell.test.ts` (after the existing tests, before the block's closing `});`):

```ts
  it("binds the project read-only when projectReadOnly is set", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-ws-"));
    const repo = mkdtempSync(join(tmpdir(), "otter-repo-"));
    try {
      const built = buildSandboxPlan(dir, new Map(), ["/bin/sh", "-c", "true"], {
        projectRepoPath: repo,
        projectReadOnly: true,
      });
      if ("error" in built) return; // no OS sandbox here
      const { plan, sandbox } = built;
      if (sandbox === "bwrap") {
        const bindIdx = plan.args.indexOf(repo);
        expect(bindIdx).toBeGreaterThan(-1);
        expect(plan.args[bindIdx - 1]).toBe("--ro-bind");
        expect(plan.args[bindIdx + 1]).toBe("/project");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/server test shell`
Expected: FAIL — `projectReadOnly` is not a known option and the bind is still `--bind` (or a TS error on the unknown property).

- [ ] **Step 3: Add `projectReadOnly` to `SandboxOpts`**

In `packages/server/src/integrations/shell.ts`, add a field to the `SandboxOpts` interface, after `projectRepoPath?: string;` (~line 134):

```ts
  projectRepoPath?: string;
  /**
   * Bind the project tree read-only (`--ro-bind`) instead of writable. Used for
   * project members granted read-only access — they can read/grep the source
   * but cannot modify it. bwrap only; sandbox-exec does not enforce this.
   */
  projectReadOnly?: boolean;
```

- [ ] **Step 4: Use `--ro-bind` in `bwrapPlan` when read-only**

In the same file, in `bwrapPlan`, replace the project bind block (~line 205-207):

```ts
  if (opts.projectRepoPath) {
    args.push("--bind", opts.projectRepoPath, PROJECT_MOUNT);
  }
```

with:

```ts
  if (opts.projectRepoPath) {
    args.push(opts.projectReadOnly ? "--ro-bind" : "--bind", opts.projectRepoPath, PROJECT_MOUNT);
  }
```

- [ ] **Step 5: Thread `projectReadOnly` through `runAgentShell`**

In the same file, update `runAgentShell`'s `opts` type and the `buildSandboxPlan` call it makes. Change the signature (~line 343):

```ts
export function runAgentShell(
  workspaceDir: string,
  secrets: Map<string, string>,
  command: string,
  opts: { projectRepoPath?: string; projectReadOnly?: boolean } = {}
): Promise<ShellResult> {
```

and the `buildSandboxPlan(...)` call inside it (~line 349):

```ts
  const built = buildSandboxPlan(workspaceDir, secrets, ["/bin/sh", "-c", command], {
    projectRepoPath: opts.projectRepoPath,
    projectReadOnly: opts.projectReadOnly,
  });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @otterbot/server test shell`
Expected: PASS (the new test plus the existing shell tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/integrations/shell.ts packages/server/src/integrations/shell.test.ts
git commit -m "feat(projects): support read-only project bind in the sandbox"
```

---

### Task 3: Wire projectAccess thunk + enforce read-only in tools

**Files:**
- Modify: `packages/server/src/runtime/agent-context.ts` (`AgentContext` ~62; `BuildAgentContextInput` ~119; `buildAgentContext` literal ~186)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`buildAgentContext({...})` call ~1066)
- Modify: `packages/server/src/agent/tools.ts` (`shell_exec` ~561; `coding_cli_run` execute ~617)

Runtime plumbing + tool guards; verified by a clean compile (behavior is covered by Task 2's sandbox test and the manual smoke in Task 7).

- [ ] **Step 1: Add the `projectAccess` thunk to the context interfaces**

In `packages/server/src/runtime/agent-context.ts`, add to the `AgentContext` interface, immediately after the `projectRules` field (~line 62):

```ts
  /**
   * The access level for this agent's project (`'read'` | `'write'`), or null
   * when it belongs to no project. A thunk so access changes take effect on the
   * next turn without rebuilding the context.
   */
  projectAccess: () => "read" | "write" | null;
```

Add to the `BuildAgentContextInput` interface, immediately after the `resolveProjectRules` field (~line 119):

```ts
  /** Resolve the agent's project access level, or null. Called live. */
  resolveProjectAccess?: () => "read" | "write" | null;
```

In `buildAgentContext`, in the `ctx` object literal, add immediately after the `projectRules` assignment (~line 186):

```ts
    projectAccess: input.resolveProjectAccess ?? (() => null),
```

- [ ] **Step 2: Pass the resolver from the orchestrator**

In `packages/server/src/orchestrator/orchestrator.ts`, in the `buildAgentContext({ ... })` call, add immediately after the `resolveProjectRules:` line (~line 1066):

```ts
      resolveProjectAccess: () => this.projects.accessForAgent(profile.id),
```

- [ ] **Step 3: Pass read-only to `shell_exec`**

In `packages/server/src/agent/tools.ts`, in the `shell_exec` tool's `execute`, update the `runAgentShell` call (~line 561):

```ts
        const r = await runAgentShell(ctx.workspaceDir, ctx.shellSecrets(), command, {
          projectRepoPath: ctx.projectRepoPath() ?? undefined,
          projectReadOnly: ctx.projectAccess() === "read",
        });
```

- [ ] **Step 4: Refuse `coding_cli_run` for read-only members**

In the same file, in the `coding_cli_run` tool's `execute`, find this line (~line 617):

```ts
        const projectRepoPath = ctx.projectRepoPath();
```

Insert immediately after it:

```ts
        if (projectRepoPath && ctx.projectAccess() === "read") {
          return {
            ok: false,
            error:
              "You have read-only access to this project, so you can't run coding tools that " +
              "modify its source. Ask the project owner for read-write access.",
          };
        }
```

- [ ] **Step 5: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/runtime/agent-context.ts packages/server/src/orchestrator/orchestrator.ts packages/server/src/agent/tools.ts
git commit -m "feat(projects): wire projectAccess thunk and enforce read-only in tools"
```

---

### Task 4: Server API — access on members + team write + listProjects

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`addProjectMember` ~1678; add `setProjectMemberAccess`; `provisionProjectTeam` addMember ~1665; `listProjects` ~1297-1311)
- Modify: `packages/server/src/server.ts` (POST members ~494; add PATCH after DELETE members ~518)

- [ ] **Step 1: Add access to the orchestrator member methods**

In `packages/server/src/orchestrator/orchestrator.ts`, replace the `addProjectMember` method (~1678) with:

```ts
  /** Add an agent to a project with optional access (default read-only). Throws if the project or agent is unknown. */
  addProjectMember(projectId: string, agentId: string, access: "read" | "write" = "read"): void {
    if (!this.contexts.has(agentId)) throw new Error(`Unknown agent: ${agentId}`);
    this.projects.addMember(projectId, agentId, access);
  }

  /** Change a project member's access level. */
  setProjectMemberAccess(projectId: string, agentId: string, access: "read" | "write"): void {
    this.projects.setMemberAccess(projectId, agentId, access);
  }
```

- [ ] **Step 2: Provision team members as writable**

In the same file, in `provisionProjectTeam`, change the team `addMember` call (~line 1665) from:

```ts
      this.projects.addMember(projectId, id);
```

to:

```ts
      this.projects.addMember(projectId, id, "write");
```

- [ ] **Step 3: Return detailed members from `listProjects`**

In the same file, update `listProjects` (~1297-1311) — change the declared `members` type and the value:

```ts
  /** A project plus its current member agents (with access) and role→agent team map. */
  listProjects(): Array<{
    id: string;
    name: string;
    repoPath: string;
    createdAt: string;
    members: Array<{ agentId: string; access: "read" | "write" }>;
    team: Array<{ role: string; agentId: string }>;
  }> {
    return this.projects.list().map((p) => ({
      ...p,
      members: this.projects.listMembersDetailed(p.id),
      team: this.projects.getTeam(p.id),
    }));
  }
```

- [ ] **Step 4: Accept `access` on the POST members route**

In `packages/server/src/server.ts`, replace the POST members route (~494-510) with:

```ts
  app.post<{ Params: { id: string }; Body: { agentId?: string; access?: "read" | "write" } }>(
    "/api/projects/:id/members",
    async (req, reply) => {
      const agentId = req.body?.agentId;
      if (!agentId) {
        reply.code(400);
        return { error: "agentId is required" };
      }
      try {
        orch.addProjectMember(req.params.id, agentId, req.body?.access ?? "read");
        return { ok: true, members: orch.listProjects().find((p) => p.id === req.params.id)?.members ?? [] };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
```

- [ ] **Step 5: Add the PATCH access route**

In the same file, add this route immediately after the `DELETE /api/projects/:id/members/:agentId` handler (~518):

```ts
  app.patch<{ Params: { id: string; agentId: string }; Body: { access?: "read" | "write" } }>(
    "/api/projects/:id/members/:agentId",
    async (req, reply) => {
      const access = req.body?.access;
      if (access !== "read" && access !== "write") {
        reply.code(400);
        return { error: "access must be 'read' or 'write'" };
      }
      orch.setProjectMemberAccess(req.params.id, req.params.agentId, access);
      return { ok: true };
    }
  );
```

- [ ] **Step 6: Verify it compiles**

Run: `pnpm --filter @otterbot/server build`
Expected: PASS (no type errors).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts packages/server/src/server.ts
git commit -m "feat(projects): API for member access (POST access, PATCH access, team write)"
```

---

### Task 5: Web store — member access + roster consumer

**Files:**
- Modify: `packages/web/src/stores/projects-store.ts` (`Project.members` ~10; `ProjectsState` actions ~71-72; action impls ~159-176)
- Modify: `packages/web/src/components/agents/AgentRoster.tsx` (member loop ~83)

- [ ] **Step 1: Change the `Project.members` type**

In `packages/web/src/stores/projects-store.ts`, in the `Project` interface, change:

```ts
  members: string[];
```

to:

```ts
  members: Array<{ agentId: string; access: "read" | "write" }>;
```

- [ ] **Step 2: Update the `ProjectsState` action signatures**

In the `ProjectsState` interface, replace the existing `addMember` signature and add `setMemberAccess` right after it (~line 71-72):

```ts
  addMember: (projectId: string, agentId: string, access?: "read" | "write") => Promise<void>;
  setMemberAccess: (projectId: string, agentId: string, access: "read" | "write") => Promise<void>;
  removeMember: (projectId: string, agentId: string) => Promise<void>;
```

- [ ] **Step 3: Update the `addMember` impl and add `setMemberAccess`**

In the store object, replace the existing `addMember` action (~159-167) with:

```ts
  addMember: async (projectId, agentId, access = "read") => {
    const res = await apiFetch(`/api/projects/${projectId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId, access }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    await get().load();
  },

  setMemberAccess: async (projectId, agentId, access) => {
    const res = await apiFetch(`/api/projects/${projectId}/members/${encodeURIComponent(agentId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access }),
    });
    if (!res.ok) return set({ error: await readError(res) });
    await get().load();
  },
```

- [ ] **Step 4: Update the roster's member loop**

In `packages/web/src/components/agents/AgentRoster.tsx`, find the member-grouping loop (~line 83):

```ts
      for (const memberId of p.members) {
```

Change it to destructure the new object shape:

```ts
      for (const { agentId: memberId } of p.members) {
```

- [ ] **Step 5: Verify it compiles**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (no type errors). If the build flags any other consumer of `project.members`, update it to use `.agentId` — but `AgentRoster.tsx` is the only current consumer.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/stores/projects-store.ts packages/web/src/components/agents/AgentRoster.tsx
git commit -m "feat(web): member access in projects store + roster consumer update"
```

---

### Task 6: Web UI — "Additional agents" section on the project card

**Files:**
- Modify: `packages/web/src/components/agents/ProjectsView.tsx` (`ProjectCard` — selectors/state ~62-80; render after the team chips ~109)

- [ ] **Step 1: Add store selectors and picker state**

In `packages/web/src/components/agents/ProjectsView.tsx`, inside `ProjectCard`, add these store selectors next to the existing ones (after the `setRules`/`startPipeline` selectors ~70-71):

```ts
  const addMember = useProjectsStore((s) => s.addMember);
  const removeMember = useProjectsStore((s) => s.removeMember);
  const setMemberAccess = useProjectsStore((s) => s.setMemberAccess);
```

Add picker state next to the other `useState` hooks (~72-82):

```ts
  const [pickAgent, setPickAgent] = useState("");
```

- [ ] **Step 2: Compute the team set, extra members, and candidates**

In `ProjectCard`, just before the `return (`, add:

```ts
  const teamIds = new Set(project.team.map((t) => t.agentId));
  const extraMembers = project.members.filter((m) => !teamIds.has(m.agentId));
  const candidateAgents = agents.filter(
    (a) => a.role !== "subagent" && !project.members.some((m) => m.agentId === a.id)
  );
```

(`agents` is already selected in `ProjectCard` via `const agents = useAgentsStore((s) => s.agents);`, and `nameFor` already exists.)

- [ ] **Step 3: Render the "Additional agents" section**

In `ProjectCard`'s JSX, find the team-roles block (the `<div>` that maps `project.team` into `chip` spans, ending with its closing `</div>`). Immediately after that closing `</div>` (and before the "Code location" block), insert:

```tsx
      {/* Additional agents */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Additional agents</div>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", margin: "2px 0 6px" }}>
        Give another agent access to this project's source (e.g. a Discord support bot). Read-only by
        default; the agent still needs shell or code-search tools to use it.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {extraMembers.length === 0 && (
          <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>None yet.</span>
        )}
        {extraMembers.map((m) => (
          <div key={m.agentId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {nameFor(m.agentId)}
            </span>
            <select
              data-testid={`member-access-${m.agentId}`}
              value={m.access}
              onChange={(e) => void setMemberAccess(project.id, m.agentId, e.target.value as "read" | "write")}
              style={{ ...input, flex: "none", width: 130 }}
            >
              <option value="read">read-only</option>
              <option value="write">read-write</option>
            </select>
            <button style={iconBtn} title="Remove from project" onClick={() => void removeMember(project.id, m.agentId)}>
              <Icon icon={Trash2} size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <select value={pickAgent} onChange={(e) => setPickAgent(e.target.value)} style={input}>
          <option value="">Add an agent…</option>
          {candidateAgents.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <button
          style={primaryBtn}
          disabled={!pickAgent}
          onClick={async () => {
            await addMember(project.id, pickAgent);
            setPickAgent("");
          }}
        >
          <Icon icon={Plus} size={14} /> Add
        </button>
      </div>
```

(`input`, `primaryBtn`, `iconBtn` are module-level style constants already defined in this file; `Plus` and `Trash2` are already imported from `lucide-react`; `Icon` is already imported.)

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/ProjectsView.tsx
git commit -m "feat(web): add/remove project members with access toggle on the card"
```

---

### Task 7: Full verification + final review

**Files:** none (verification only)

- [ ] **Step 1: Server build + full test suite**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/server test`
Expected: PASS — including the new `project-store` and `shell` tests.

- [ ] **Step 2: Web build**

Run: `pnpm --filter @otterbot/web build`
Expected: PASS (clean compile).

- [ ] **Step 3: Manual smoke test**

Run `pnpm dev`, then in the UI:
- Open a project's card → "Additional agents" → pick an existing agent (e.g. a Discord/support agent that has `shell_exec`) and click Add. Confirm it appears as `read-only`.
- As that agent, run `shell_exec` `ls /project` and `cat` a source file → reads succeed. Run `touch /project/x` → fails (read-only bind).
- Toggle the member to `read-write`, re-run `touch /project/x` → succeeds.
- If that agent has the coding capability, confirm `coding_cli_run` is refused while read-only and allowed when read-write.
- Click ✕ to remove the member; confirm `/project` is no longer bound on its next `shell_exec` (e.g. `ls /project` shows nothing / not present).

- [ ] **Step 4: Push**

```bash
git push origin dev
```

---

## Notes / decisions captured from the spec

- **Read-only default, writable opt-in.** New members default to `'read'`; the provisioned team is `'write'`.
- **Enforcement:** `--ro-bind` for `shell_exec`; explicit refusal in `coding_cli_run`. (There is no `git_commit` tool; raw writes under read-only fail at the bind.)
- **Live:** `projectAccess` is a thunk read each turn, so access changes take effect on the next command without an agent restart.
- **Most-recent project wins**, consistent with `repoPathForAgent`.
- **Out of scope:** project-scoped Discord wiring, granting tools to the added agent, macOS `sandbox-exec` read-only enforcement, read/write for any mount other than `/project`.
