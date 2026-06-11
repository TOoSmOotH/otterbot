# Project "Add agent" wizard

## Problem

A project's **Additional agents** section (in `ProjectCard`) only offers a
dropdown of *existing* agents. To add a brand-new agent you must leave for the
roster, create it, then come back and select it. We want the new-agent wizard
right here, with "use an existing agent" as one option inside it.

## Scope

`packages/web` only. No backend changes — reuses `POST /api/agents` (create)
and the existing `addMember` projects-store action.

Limited to the **Additional agents** section. Team-role slots are out of scope.

## Design

### Entry point

In `ProjectCard`, replace the inline "Add an agent…" dropdown + Add button with
a single **Add agent** button. Clicking it opens `ProjectAddAgentWizard`. The
existing list of extra members (each with its read/write access select) is
unchanged and stays above the button.

### New component: `ProjectAddAgentWizard.tsx`

Lives next to `AgentWizard.tsx`, styled to match (same overlay/modal/card look).

Props: `{ project, candidateAgents, onClose }`.

Step state `"menu" | "existing" | "single"`:

- **menu** — two cards:
  - *Use an existing agent* → `existing`
  - *Single agent* → `single`
  - Coding team / Infrastructure are intentionally omitted — they don't join
    this project.
- **existing** — the dropdown of `candidateAgents` + a read/write access select
  + Add. Calls `addMember(project.id, id, access)`, then `onClose()`.
- **single** — renders the existing `AgentEditor` (its own full-screen modal,
  the same way `AgentWizard` does for "single"). On create, the new agent is
  auto-added to this project as a member (default read-only access).

### Auto-add wiring

`AgentEditor` currently calls `onClose()` after create but never reports the
created agent. Add one optional prop:

```ts
onCreated?: (agentId: string) => void | Promise<void>;
```

It is invoked with `created.id` in the create branch only (edit path untouched),
awaited before `onClose()`. The wizard passes
`onCreated={(id) => addMember(project.id, id)}`.

## Testing

No React component-test harness exists in `packages/web` (unit tests are
pure-logic only); UI flows use Playwright e2e. Verification:

- `pnpm --filter @otterbot/web build` — typecheck the new prop + wiring.
- e2e (`e2e/10-projects.spec.ts`): create a minimal team, open its dashboard,
  click **Add agent**, assert both cards render, choose *Use an existing agent*,
  add the COO, and assert it appears in the members list. Assert the *Single
  agent* card opens the `AgentEditor`.

## Out of scope

- Team-role create-or-reuse.
- Creating coding teams / infrastructure agents from this wizard.
