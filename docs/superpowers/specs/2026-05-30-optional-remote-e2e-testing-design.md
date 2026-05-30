# Optional remote-host end-to-end testing

**Date:** 2026-05-30
**Status:** Approved (design)

## Problem

The build pipeline's `tester` stage does no testing itself — it delegates to two
shared service agents, **Proxmox** (roll back/start a VM) and **SSH** (fetch the
branch, install, run the suite on that VM). `prepareTesterContext`
(`orchestrator.ts`) unconditionally instructs that remote-VM flow, so meaningful
testing effectively *requires* standing up a remote host. That should be
optional: a project should be able to run its tests without any VM/SSH infra.

The key distinction the design draws is **unit/integration testing** (runs
locally in the shared `/project` tree, no infra needed) vs **end-to-end testing**
(needs a remote host). Local testing should always run; remote e2e should be
opt-in.

## Decisions

- **One tester stage, two phases.** The single `tester` stage always runs the
  project's unit/integration suite locally in `/project`; it *additionally* runs
  remote e2e only when enabled.
- **Per-project toggle, default off.** A new `remoteE2e` project flag gates the
  e2e phase. The phase runs only when the flag is on **and** both the Proxmox and
  SSH service agents exist.
- **Local result always gates** PASS/FAIL. Remote e2e folds into the verdict only
  when it runs.
- **Toggle is folded into the existing forge-config save** (`PUT
  /api/projects/:id/forge` + the "Save code location" button) — no new endpoint.
- **Missing infra is not a failure.** If `remoteE2e` is on but the service agents
  aren't present at run time, the tester runs the local suite, passes/fails on
  that, and reports that e2e was skipped because infra isn't set up.

## Design

### 1. Data model

Add a per-project boolean `remoteE2e` (default `false`), mirroring the existing
`monitorIssues` flag end to end:

- `db/control-schema.ts` — `remoteE2e: integer("remote_e2e", { mode: "boolean" }).notNull().default(false)` on the `projects` table.
- `db/control-db.ts` — add `remote_e2e INTEGER NOT NULL DEFAULT 0` to the
  `CREATE TABLE projects` DDL and an `addProjectCol("remote_e2e", "remote_e2e INTEGER NOT NULL DEFAULT 0")` migration line.
- `projects/project-store.ts` — add `remoteE2e: boolean` to the `Project`
  interface and `"remoteE2e"` to the `setForge` `Pick<>` (so the existing forge
  setter persists it).

### 2. API + orchestrator

- `server.ts` — add `remoteE2e?: boolean` to the `PUT /api/projects/:id/forge`
  body type. The body is already forwarded to `setProjectForge`.
- `orchestrator.setProjectForge` — accept `remoteE2e?: boolean` in its input and
  persist it via `setForge` in **every** branch, including the `local` early
  return (the flag is independent of code-location mode).

### 3. Tester behavior (`prepareTesterContext`)

Rework the appended tester context so it is built around the local phase, with
e2e as a conditional add-on:

- **Always**: instruct the tester to build/install and run the project's
  unit/integration suite in `/project` via `shell_exec`, and emit
  `VERDICT: PASS|FAIL` from that result.
- **When `remoteE2e` is on AND both service agents exist**: also push the run
  branch (the forge-push logic that today runs unconditionally moves *inside*
  this branch) and append the existing "delegate to Proxmox → SSH → fetch /
  install / run on the VM" instructions, folding e2e into the verdict. For a
  local-only project, keep the existing note about the VM reaching `/project`.
- **When off, or the toggle is on but a service agent is missing**: local phase
  only — no branch push for testing, no remote instructions. When the toggle was
  on but infra is absent, add a line telling the tester to report that remote
  e2e was requested but skipped (infra not set up) and to base the verdict on the
  local suite.

Consequence: a project with e2e off (or without infra) never triggers a remote
host. The final PR push in `publishRun` is unchanged.

### 4. Tester persona (`teams/team-template.ts`)

Rewrite the `tester` role persona. New framing: you run the project's
unit/integration suite locally in the shared `/project` tree with your shell; if
the task asks you to also run end-to-end tests, delegate the VM and SSH work to
the Proxmox and SSH service agents and fold their results into your verdict. (The
role keeps `canRunShell: true` and its `peerServices` wiring so it *can* delegate
when asked.)

### 5. UI (`web` — `ProjectsView.tsx` + `projects-store.ts`)

- `projects-store.ts` — add `remoteE2e: boolean` to the `Project` type and
  `remoteE2e?: boolean` to the `setForge` input; pass it through in `setForge`.
- `ProjectsView.tsx` — add a "Remote end-to-end testing" checkbox to the project
  card, saved by the existing "Save code location" button (include `remoteE2e` in
  the `setForge` call). Because e2e is independent of code-location mode, the
  checkbox is shown regardless of mode (unlike the forge fields, which stay gated
  on `mode !== "local"`). Add a short caption noting it needs the Proxmox + SSH
  service agents.

## Testing

- `project-store.test.ts` — `remoteE2e` defaults to `false` and round-trips
  through `setForge` (on for fork/existing/new and for `local`).
- `orchestrator` / `prepareTesterContext` — unit-cover the branch selection where
  feasible: off → local-only text with no VM delegation; on + agents present →
  includes delegation + branch push; on + agents missing → local-only text with
  the "e2e skipped" note. (Follow the existing convention: the live git/VM path
  is exercised by manual verification, not units.)

## Verification

1. `pnpm --filter @otterbot/server build` and `pnpm --filter @otterbot/web build`.
2. `pnpm --filter @otterbot/server test`.
3. Manual: create a coding team with `remoteE2e` **off**; run a goal and confirm
   the tester runs the suite in `/project` and emits a verdict with no Proxmox/SSH
   delegation and no remote host involved. Toggle it **on** with the service
   agents present and confirm the tester additionally delegates the VM/SSH e2e
   run. Toggle **on** without the service agents and confirm it runs locally and
   reports e2e was skipped.

## Out of scope

- Per-project choice of *which* command runs the unit suite (the tester infers it
  from the project, as today).
- Splitting unit and e2e into separate pipeline stages (explicitly rejected in
  favor of one tester with two phases).
- Auto-creating the service agents from the toggle.
