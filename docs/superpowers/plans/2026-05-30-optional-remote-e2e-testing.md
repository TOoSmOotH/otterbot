# Optional Remote-Host E2E Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline tester always run unit/integration tests locally in `/project`, and only run remote-host end-to-end tests when a per-project `remoteE2e` toggle is on and the Proxmox/SSH service agents exist.

**Architecture:** Add a `remoteE2e` boolean to projects (mirrors `monitorIssues`), folded into the existing forge-config save. The single `tester` stage gains two phases driven by `prepareTesterContext`: a local unit/integration run always, plus optional VM/SSH delegation. The run-branch push moves inside the e2e branch so e2e-off projects never need a remote host. Tester persona is reworded to match.

**Tech Stack:** TypeScript, Fastify, Drizzle + better-sqlite3, Vitest (server); React + Zustand (web).

---

## File Structure

- `packages/server/src/db/control-schema.ts` — add `remoteE2e` column to `projects`.
- `packages/server/src/db/control-db.ts` — DDL + migration for `remote_e2e`.
- `packages/server/src/projects/project-store.ts` — `Project.remoteE2e` + `setForge` Pick.
- `packages/server/src/projects/project-store.test.ts` — round-trip test (the TDD unit).
- `packages/server/src/server.ts` — `remoteE2e?` on the forge PUT body.
- `packages/server/src/orchestrator/orchestrator.ts` — persist `remoteE2e`; two-phase `prepareTesterContext`; import service-agent ids.
- `packages/server/src/teams/team-template.ts` — tester persona rewrite.
- `packages/web/src/stores/projects-store.ts` — `Project.remoteE2e` + `setForge` input.
- `packages/web/src/components/agents/ProjectsView.tsx` — toggle in the project card.

All commands run from the repo root `/home/mreeves/Projects/Personal/otter/otterbot`.

---

## Task 1: Add the `remoteE2e` project field (schema + store) — TDD

**Files:**
- Modify: `packages/server/src/db/control-schema.ts` (projects table, after `monitorIssues`)
- Modify: `packages/server/src/db/control-db.ts` (CREATE TABLE projects + migrations)
- Modify: `packages/server/src/projects/project-store.ts` (`Project` type + `setForge` Pick)
- Test: `packages/server/src/projects/project-store.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test in `project-store.test.ts` immediately after the existing
`"round-trips fork mode: ..."` test (around line 138):

```ts
  it("defaults remoteE2e off and round-trips the flag via setForge", () => {
    const p = store.create("E2E Toggle");
    expect(p.remoteE2e).toBe(false);
    // Turn it on alongside an existing-repo config.
    store.setForge(p.id, {
      mode: "existing",
      forgeAccountId: "acc1",
      forgeRepo: "o/n",
      remoteE2e: true,
    });
    expect(store.get(p.id)!.remoteE2e).toBe(true);
    // And a local-mode save can turn it back off.
    store.setForge(p.id, { mode: "local", remoteE2e: false });
    expect(store.get(p.id)!.remoteE2e).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/server && pnpm exec vitest run src/projects/project-store.test.ts -t "remoteE2e"`
Expected: FAIL — `remoteE2e` is `undefined` (not `false`), and/or a TS error that
`remoteE2e` is not in the `setForge` Pick.

- [ ] **Step 3: Add the schema column**

In `control-schema.ts`, in the `projects` table, add the column right after the
`monitorIssues` line:

```ts
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: integer("monitor_issues", { mode: "boolean" }).notNull().default(false),
  /** Run remote-host (Proxmox/SSH VM) end-to-end tests in the tester stage. */
  remoteE2e: integer("remote_e2e", { mode: "boolean" }).notNull().default(false),
```

In `control-db.ts`, add `remote_e2e` to the `CREATE TABLE projects` DDL right
after `monitor_issues`:

```ts
      monitor_issues INTEGER NOT NULL DEFAULT 0,
      remote_e2e INTEGER NOT NULL DEFAULT 0,
      rules TEXT,
```

And add a migration line next to the other `addProjectCol(...)` calls:

```ts
  addProjectCol("monitor_issues", "monitor_issues INTEGER NOT NULL DEFAULT 0");
  addProjectCol("remote_e2e", "remote_e2e INTEGER NOT NULL DEFAULT 0");
  addProjectCol("rules", "rules TEXT");
```

- [ ] **Step 4: Extend the `Project` type + `setForge` signature**

In `project-store.ts`, add to the `Project` interface right after `monitorIssues`:

```ts
  /** Poll the forge for assigned issues to feed the pipeline. */
  monitorIssues: boolean;
  /** Run remote-host (Proxmox/SSH VM) end-to-end tests in the tester stage. */
  remoteE2e: boolean;
```

And add `"remoteE2e"` to the `setForge` Pick:

```ts
    patch: Partial<
      Pick<Project, "mode" | "forgeAccountId" | "forgeRepo" | "forkRepo" | "forgeSshUrl" | "baseBranch" | "monitorIssues" | "remoteE2e">
    >
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/server && pnpm exec vitest run src/projects/project-store.test.ts`
Expected: PASS (all ProjectStore tests, including the new one).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db/control-schema.ts packages/server/src/db/control-db.ts packages/server/src/projects/project-store.ts packages/server/src/projects/project-store.test.ts
git commit -m "Add remoteE2e project flag (schema + store)"
```

---

## Task 2: Persist `remoteE2e` through the API + orchestrator

**Files:**
- Modify: `packages/server/src/server.ts` (forge PUT body type, ~line 455)
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (`setProjectForge`, ~line 1410)

- [ ] **Step 1: Add `remoteE2e` to the API body type**

In `server.ts`, the `PUT /api/projects/:id/forge` handler — add the field to the
`Body` type:

```ts
    Body: {
      mode?: "local" | "existing" | "new" | "fork";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
      remoteE2e?: boolean;
    };
```

(The body is already spread into `setProjectForge` via `{ ...req.body, mode }`.)

- [ ] **Step 2: Accept `remoteE2e` in `setProjectForge` input**

In `orchestrator.ts`, widen the `setProjectForge` input type:

```ts
    input: {
      mode: "local" | "existing" | "new" | "fork";
      accountId?: string | null;
      repo?: string | null;
      baseBranch?: string | null;
      monitorIssues?: boolean;
      remoteE2e?: boolean;
    }
```

- [ ] **Step 3: Persist it in the `local` branch**

In `setProjectForge`, the `if (input.mode === "local")` block — add `remoteE2e`:

```ts
    if (input.mode === "local") {
      this.projects.setForge(projectId, {
        mode: "local",
        forgeAccountId: null,
        forgeRepo: null,
        forkRepo: null,
        monitorIssues: false,
        remoteE2e: input.remoteE2e ?? false,
      });
      return { ok: true };
    }
```

- [ ] **Step 4: Persist it in the forge-backed branch**

In the same method, the `this.projects.setForge(projectId, { ... })` call inside
the `try` block — add `remoteE2e`:

```ts
      this.projects.setForge(projectId, {
        mode: input.mode,
        forgeAccountId: input.accountId ?? null,
        forgeRepo: fullRepo,
        forkRepo: input.mode === "fork" ? cloneFullRepo : null,
        forgeSshUrl: cloneRepo.sshUrl ?? null,
        baseBranch: input.baseBranch ?? upstream.defaultBranch,
        monitorIssues: input.monitorIssues ?? false,
        remoteE2e: input.remoteE2e ?? false,
      });
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @otterbot/server build`
Expected: no errors (tsc exits 0).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/server.ts packages/server/src/orchestrator/orchestrator.ts
git commit -m "Persist remoteE2e through the forge-config API"
```

---

## Task 3: Two-phase `prepareTesterContext`

**Files:**
- Modify: `packages/server/src/orchestrator/orchestrator.ts` (import ids; rewrite `prepareTesterContext`, ~line 1515)

The tester context must always describe a local unit/integration run, push the
run branch and add VM/SSH delegation only when `remoteE2e` is on AND both service
agents exist, and note "e2e skipped" when the toggle is on but infra is missing.

- [ ] **Step 1: Import the service-agent ids**

In `orchestrator.ts`, extend the existing import from `../teams/team-template.js`:

```ts
import {
  SERVICE_AGENTS,
  SVC_PROXMOX_ID,
  SVC_SSH_ID,
  TEAM_ROLES,
  teamAgentId,
  serviceSpecForKind,
  type TeamConfig,
} from "../teams/team-template.js";
```

- [ ] **Step 2: Rewrite `prepareTesterContext`**

Replace the entire `prepareTesterContext` method body (from `const project =
this.projects.get(projectId);` through the final `}`) with:

```ts
  private prepareTesterContext(projectId: string, runId: string): string {
    const project = this.projects.get(projectId);
    if (!project) return "";

    // The local phase always runs: build/install and run the project's unit and
    // integration suite in the shared /project tree.
    const local =
      `\n\n## Testing\n### Unit & integration tests (always)\nRun the project's ` +
      `unit/integration suite locally in /project with your shell (shell_exec): ` +
      `detect and run the build/install and test commands, then report results. ` +
      `Your VERDICT must be based on this local run.`;

    // The remote e2e phase is opt-in (per-project toggle) and needs both shared
    // service agents present to delegate to.
    const haveInfra = this.contexts.has(SVC_PROXMOX_ID) && this.contexts.has(SVC_SSH_ID);
    if (!project.remoteE2e) {
      return local + `\n\nEnd with VERDICT: PASS or VERDICT: FAIL.`;
    }
    if (!haveInfra) {
      return (
        local +
        `\n\n### End-to-end tests (skipped)\nRemote end-to-end testing is enabled ` +
        `for this project, but the Proxmox/SSH service agents are not set up, so ` +
        `e2e was skipped. Note this in your report and base the verdict on the ` +
        `local run. End with VERDICT: PASS or VERDICT: FAIL.`
      );
    }

    // Infra present: push the run branch so the VM can fetch it, then delegate.
    const branch = `otterbot/run-${runId.slice(0, 8)}`;
    let e2e: string;
    if (project.mode === "local" || !project.forgeRepo) {
      e2e =
        `\n\n### End-to-end tests (remote)\nThis is a local-only project; the code ` +
        `lives at /project. Delegate to the Proxmox Service agent to prepare a clean ` +
        `VM and to the SSH Service agent to run the test suite against a checkout of ` +
        `/project (the code is not on a remote, so the VM must reach it by a means ` +
        `your SSH host is configured for). Fold the e2e result into your verdict.`;
    } else {
      const target = this.gitTargetFor(project);
      let pushNote = "not pushed";
      if (target) {
        const ensure = this.projects.ensureBranch(project.repoPath, branch);
        if (ensure.ok) {
          this.projects.commitAll(
            project.repoPath,
            `otterbot: pipeline run ${runId.slice(0, 8)}`,
            target.ctx
          );
          const push = this.projects.push(project.repoPath, target.url, branch, target.ctx);
          pushNote = push.ok ? "pushed" : `push failed (${push.output})`;
          if (push.ok) this.pipeline.setPrInfo(runId, { branch });
        } else {
          pushNote = `branch failed (${ensure.output})`;
        }
      }
      const codeRepo = project.forkRepo ?? project.forgeRepo;
      const repoKind =
        project.mode === "new"
          ? "new repo"
          : project.mode === "fork"
            ? "fork of " + project.forgeRepo
            : "existing repo";
      e2e =
        `\n\n### End-to-end tests (remote)\nThe project code is on ${codeRepo} ` +
        `(${repoKind}), branch \`${branch}\` (${pushNote}). Delegate to the Proxmox ` +
        `Service agent to roll back to a clean snapshot and start the test VM, then ` +
        `to the SSH Service agent to fetch branch \`${branch}\` of ${codeRepo}, ` +
        `install, and run the test suite, and report results. (The VM needs its own ` +
        `access to clone the repo.) Fold the e2e result into your verdict.`;
    }

    return local + e2e + `\n\nEnd with VERDICT: PASS or VERDICT: FAIL.`;
  }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @otterbot/server build`
Expected: no errors. (Confirms `SVC_PROXMOX_ID`/`SVC_SSH_ID` are exported and the
method compiles.)

- [ ] **Step 4: Run the server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: all tests pass (no regressions; existing suite has no direct test of
this private method).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/orchestrator/orchestrator.ts
git commit -m "Make tester run local tests always, remote e2e only when enabled"
```

---

## Task 4: Rework the tester persona

**Files:**
- Modify: `packages/server/src/teams/team-template.ts` (the `tester` role, ~line 139)

- [ ] **Step 1: Replace the tester persona text**

In `team-template.ts`, replace the `tester` role's `persona` string with:

```ts
    persona: `You run the tests for this project. First, always run the project's
unit and integration suite locally in the shared /project tree using your shell
(shell_exec): detect the build/install and test commands, run them, and base your
PASS/FAIL verdict on the result. If the task also asks for end-to-end testing, you
do NOT have VM or SSH access yourself — delegate: ask the Proxmox Service agent to
roll back to a clean snapshot and start the test VM, then ask the SSH Service agent
to fetch the branch, install, and run the suite on that VM; fold their result into
your verdict. Use the delegate tool to reach the two service agents by id. Return a
clear pass/fail with the relevant logs.`,
```

(Leave `capabilities`, `canRunShell: true`, and `peerServices` unchanged.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @otterbot/server build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/teams/team-template.ts
git commit -m "Reword tester persona: local tests always, e2e delegated on request"
```

---

## Task 5: Web — toggle in the project card

**Files:**
- Modify: `packages/web/src/stores/projects-store.ts` (`Project` type + `setForge` input)
- Modify: `packages/web/src/components/agents/ProjectsView.tsx` (form state + checkbox)

- [ ] **Step 1: Add `remoteE2e` to the web `Project` type + `setForge` input**

In `projects-store.ts`, add to the `Project` interface after `monitorIssues`:

```ts
  monitorIssues: boolean;
  remoteE2e: boolean;
```

And add to the `setForge` input type (after `monitorIssues?: boolean;`):

```ts
      monitorIssues?: boolean;
      remoteE2e?: boolean;
```

(`setForge` JSON-stringifies its input, so no other store change is needed.)

- [ ] **Step 2: Add `remoteE2e` to the card's form state**

In `ProjectsView.tsx`, in `ProjectCard`, extend the `forge` form state:

```ts
  const [forge, setForgeForm] = useState({
    mode: project.mode,
    accountId: project.forgeAccountId ?? "",
    repo: project.forgeRepo ?? "",
    baseBranch: project.baseBranch ?? "",
    monitorIssues: project.monitorIssues,
    remoteE2e: project.remoteE2e,
  });
```

- [ ] **Step 3: Render the checkbox (outside the `mode !== "local"` block)**

In `ProjectsView.tsx`, the "Code location" `<div style={{ display: "grid", ... }}>`
grid closes with `</div>` right before the `<button ... >{busy ? "Saving…" :
"Save code location"}</button>`. Insert this between that closing `</div>` and the
Save button:

```tsx
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))", marginTop: 6 }}>
        <input
          type="checkbox"
          checked={forge.remoteE2e}
          onChange={(e) => setForgeForm({ ...forge, remoteE2e: e.target.checked })}
        />
        Remote end-to-end testing (needs the Proxmox + SSH service agents)
      </label>
```

- [ ] **Step 4: Include `remoteE2e` in the save call**

In the "Save code location" button's `onClick`, add `remoteE2e` to the `setForge`
payload:

```ts
          await setForge(project.id, {
            mode: forge.mode,
            accountId: forge.accountId || null,
            repo: forge.repo || null,
            baseBranch: forge.baseBranch || null,
            monitorIssues: forge.monitorIssues,
            remoteE2e: forge.remoteE2e,
          });
```

- [ ] **Step 5: Build the web app**

Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds (tsc + vite, exit 0).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/stores/projects-store.ts packages/web/src/components/agents/ProjectsView.tsx
git commit -m "Add remote e2e testing toggle to the project card"
```

---

## Task 6: Full verification

- [ ] **Step 1: Build both packages**

Run: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/web build`
Expected: both exit 0.

- [ ] **Step 2: Run the server test suite**

Run: `pnpm --filter @otterbot/server test`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke (optional, requires a running instance)**

Start the app (`pnpm dev`), create a coding team, leave "Remote end-to-end
testing" off, run a small goal, and confirm the tester stage's prompt runs the
suite in /project with no Proxmox/SSH delegation. Then toggle it on (with the
service agents created) and confirm the tester additionally delegates the VM/SSH
e2e run; toggle on without the service agents and confirm it runs locally and
reports e2e skipped.

- [ ] **Step 4: Push**

```bash
git push origin dev
```

---

## Notes for the implementer

- `remoteE2e` mirrors `monitorIssues` exactly — when in doubt, copy that field's
  pattern in the same file.
- `prepareTesterContext` is a private method that performs real git operations;
  the project's convention (see the fork work) is to not unit-test the live
  git/VM path — coverage comes from the Task 1 store test plus the build and
  manual smoke. Do not add a brittle network/git test for it.
- The local unit-test phase is driven entirely by prompt text; there is no new
  code that runs the suite — the tester agent does, via `shell_exec`.
