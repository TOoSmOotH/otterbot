# PM Issue Triage → Plan-Fed Auto-Build

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan

## Context

Otterbot projects already have most of a forge automation loop: a `ForgeMonitor`
polls forge-backed projects every 5 minutes, and when an issue is **assigned to the
bot account** it auto-starts the build pipeline (coder → security-reviewer →
test-writer → tester), opens a PR, and loops PR review/CI failures back to the
coder. This works for both GitHub and Gitea through a shared `Forge` abstraction.

The missing piece — the user's intended workflow — is **triage**: before a human
assigns an issue, the PM should engage with it. Specifically:

- A user files an issue (bug or feature).
- The PM, **with the coder**, drafts an initial implementation plan and posts it as
  a comment on the issue.
- A maintainer (or the issue's author) asks clarifying questions in the issue. The
  PM revises the plan **with the coder** and replies with the updated plan. This can
  repeat.
- Once someone assigns the issue to the bot, the existing pipeline implements the
  **latest** plan.

This keeps wasted work and tokens down: the plan is agreed *in the issue* before any
code is written, and only trusted users can drive plan revisions.

## Decisions (from brainstorming)

- **Plan author:** PM **and** Coder (PM consults the coder for both the initial plan
  and every revision).
- **Opt-in:** a **separate per-project "Triage issues" toggle**, independent of the
  existing `monitorIssues` (assign→build) toggle.
- **Who may refine the plan:** the **issue author**, OR any user with **write/maintain
  permission** on the repo. Computed live via a forge permission check — no explicit
  per-project username list to maintain.
- **Polling, not webhooks:** reuse the existing 5-minute `ForgeMonitor` loop.

## Non-goals (YAGNI)

- No webhook delivery (polling is fine and needs no public endpoint).
- No re-triage when an issue body is edited (triage once; revisions come from
  comments).
- No explicit collaborator allowlist UI (permission + author covers it).
- The assign→implement→PR→feedback loop already exists and is unchanged except for
  feeding the triaged plan into the goal.

## Architecture

### 1. Data model

- **`projects.triageIssues`** — new boolean column on the `projects` table
  (`packages/server/src/db/control-schema.ts`), mirroring `monitorIssues`. Threaded
  through:
  - `PUT /api/projects/:id/forge` body (`packages/server/src/server.ts`)
  - the server project store / `setProjectForge` (`orchestrator.ts`,
    `projects/project-store.ts`)
  - the web `Project` type (`packages/web/src/stores/projects-store.ts`)

- **`issue_triage`** — new table:

  | column        | type   | purpose                                              |
  |---------------|--------|------------------------------------------------------|
  | `id`          | text   | pk (nanoid)                                          |
  | `projectId`   | text   | FK to projects                                       |
  | `issueNumber` | int    | the triaged issue                                    |
  | `plan`        | text   | the **current** plan (latest revision)               |
  | `lastCommentId` | int  | high-water mark: highest forge comment id processed  |
  | `createdAt`   | text   |                                                      |
  | `updatedAt`   | text   |                                                      |

  Unique on `(projectId, issueNumber)`. Triple duty: dedup, current-plan storage
  (for revisions and for feeding the build), and the comment high-water mark.

### 2. Forge abstraction (`packages/server/src/forge/`)

Extend the shared `Forge` interface (`forge.ts`) and both implementations
(`github.ts`, `gitea.ts`):

- `ForgeIssue` gains `assignees: string[]` and `author: string` (issue creator
  login).
- **`listOpenIssues(repo): Promise<ForgeIssue[]>`** — open issues only.
  - GitHub: `GET /repos/{o}/{n}/issues?state=open`, **skip any entry with a
    `pull_request` field** (GitHub returns PRs in the issues list).
  - Gitea: `GET /repos/{o}/{n}/issues?state=open&type=issues`.
- **`listIssueComments(repo, issueNumber): Promise<ForgeComment[]>`** where
  `ForgeComment = { id: number; author: string; body: string; createdAt: string }`.
- **`getUserPermission(repo, username): Promise<"admin"|"write"|"read"|"none">`** —
  normalized. Both providers expose `GET /repos/{o}/{n}/collaborators/{user}/permission`
  (GitHub returns `admin|maintain|write|triage|read|none`; normalize `maintain`→`write`).
- Reuse existing `commentIssue(repo, number, body)`.

### 3. Triage + refinement loop (`forge/forge-monitor.ts`)

A new `pollTriage(project, forge)` step in the existing `pollOnce()` cycle, run for
projects whose `triageIssues` is on (add `listTriageProjects()` to the monitor deps,
parallel to `listMonitoredProjects()`).

For each **open, unassigned** issue (`assignees.length === 0`):

- **No `issue_triage` row →** initial triage:
  - `triageIssue(projectId, issue)` (orchestrator dep) → PM+coder draft a plan →
    `commentIssue(...)` with an otter marker → insert row with `plan` and
    `lastCommentId` = the posted comment's id.
- **Row exists →** refinement:
  - `listIssueComments(repo, number)`; take comments with `id > lastCommentId`,
    excluding the bot's own (`author !== account.username`).
  - A comment is an **instruction** if its author is the issue's `author` OR
    `getUserPermission(repo, author) ∈ {admin, write}`. Cache permission lookups per
    poll cycle.
  - If there are instruction comments → `refineIssuePlan(projectId, issue,
    newInstructionComments, currentPlan)` → PM+coder revise → post updated plan →
    update `plan`, set `lastCommentId` = max comment id seen.
  - If new comments exist but none are instructions → just advance `lastCommentId`
    to the max id seen (so we don't rescan them), no revision.

Skip assigned issues and PRs. Per-issue errors are isolated (best-effort), matching
the existing monitor style.

**In-flight guard:** the monitor keeps an in-memory `Set<string>` of
`${projectId}#${issueNumber}` currently being triaged/refined; entries are added
before the async LLM call and removed after. A slow PM round therefore can't be
re-triggered by the next 5-minute poll.

### 4. PM + Coder authoring (orchestrator)

`triageIssue` and `refineIssuePlan` live in the orchestrator (they need agent
runtimes + forge). Each:

1. Resolves the project's PM agent: `projects.agentForRole(projectId, "pm")`.
2. Runs a **one-shot PM response** using the same mechanism the scheduler uses
   (`scheduler.fire` → `runtime.respond(prompt)` with an ephemeral conversation id).
   Factor this into a reusable orchestrator helper (e.g. `respondOnce(agentId,
   prompt): Promise<string>`) if one does not already exist.
3. The prompt carries the issue (title/body, number) and — for revisions — the prior
   plan and the new instruction comments, and instructs the PM to: *produce/refine a
   concrete implementation plan, consulting the Coder (plan only); return the plan
   text; do NOT implement or launch the pipeline.* This exercises the PM→coder path
   the PM persona already describes.
4. The returned text is posted via `forge.commentIssue`, prefixed with an otter
   marker so it is recognizable (and so the bot can ignore its own comments by
   author anyway).

### 5. Feed the plan into the build

In the orchestrator's `startRunFromIssue` (the dep `ForgeMonitor.pollIssues` calls
for assigned issues), look up the `issue_triage` row for `issue.number`. If a `plan`
exists, build the goal as:

```
Resolve issue #<n>: <title>

<body>

Agreed plan:
<plan>
```

If there is no triaged plan (issue assigned before any triage), fall back to the
current title/body goal.

### 6. UI (`packages/web/src/components/agents/ProjectsView.tsx`)

Add a **"Triage issues"** checkbox in the project's forge settings next to the
existing "Monitor issues" checkbox. Include `triageIssues` in the `setForge`
payload and add it to the web `Project` type. No collaborator UI (permission-based).

### 7. Tests

- **`forge-monitor` unit tests** (injected deps, the file is built for this):
  - initial triage fires for a new open unassigned issue;
  - revision fires only for comments from the issue author or a write/maintain user;
  - non-allowed commenters do not trigger a revision but advance the high-water mark;
  - already-triaged issues are not re-triaged;
  - assigned issues and PRs are skipped;
  - in-flight guard prevents double-triggering.
- **Forge** light coverage: `listOpenIssues` PR-filtering; `getUserPermission`
  normalization.
- **Plan-fed goal:** `startRunFromIssue` includes the stored plan when present.

## Data flow summary

```
poll (5 min)
  └─ triageIssues on?
       ├─ open + unassigned + no row   → PM+coder draft plan → comment → store
       ├─ open + unassigned + has row  → new author/maintainer comments?
       │                                   yes → PM+coder revise → comment → update
       │                                   no  → advance high-water mark
       └─ assigned (monitorIssues on)  → startRunFromIssue (goal += stored plan) → PR
```

## Risks / considerations

- **Cost:** PM+coder per triage and per revision round; bounded by gating revisions
  to trusted users and triaging each issue once.
- **Permission API calls:** one per distinct new commenter per poll; cached per
  cycle.
- **Prompt-injection:** only issue-author / maintainer comments steer the plan;
  triage itself only drafts a plan (never implements), so an untrusted issue body
  can at worst produce a plan comment, not code changes.
- **Schema migration:** adding `projects.triageIssues` and the `issue_triage` table
  must follow the project's existing Drizzle/SQLite migration approach.
