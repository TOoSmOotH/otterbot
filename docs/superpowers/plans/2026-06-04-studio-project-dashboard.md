# The Studio — Project Pod Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Clicking a project in the sidebar opens a focused **per-project dashboard** (header + repos/team/rules editing + recent build runs), replacing the flat all-projects `ProjectsView`. Reuse the existing `ProjectCard` editor and `build-runs-store` — do not rewrite project config or the run explorer.

**Architecture:** Today `ProjectsView` is a flat scroll of `ProjectCard`s (each a full single-project editor); clicking a sidebar project opens the PM's chat; `BuildRunsView` is a separate cross-project run explorer. We add a `selectedProjectId` to the shell, point the sidebar project click at a new `ProjectDashboard` view, and build `ProjectDashboard` by **reusing the existing `ProjectCard`** (exported from `ProjectsView`) plus a new build-runs summary card. The flat `ProjectsView` becomes a lightweight **project index** (pick a project → dashboard; create a team). The full `BuildRunsView` stays as the deep run/task explorer the dashboard links into.

**Decisions (from the user):** sidebar project → dashboard; the dashboard **replaces** the flat ProjectsView config list.

**Tech Stack:** React + Zustand (`projects-store`, `build-runs-store`, `agents-store`), inline styles + `rgb(var(--token))`, lucide icons. Playwright e2e.

**Reality notes (verified in code):**
- `ProjectCard` (`ProjectsView.tsx:180`) renders one project's full editor (team roles, `ProjectTeamModels`, members, repos via `RepoRow`, rules, remote-e2e, pipeline launcher + `PipelineRun` list). It takes `{ project, onDelete, onOpenSettings }`.
- `build-runs-store` exposes `runsByProject` + `loadForProject(projectId)` and `BuildRunSummary { id, goal, status, prNumber, prUrl, createdAt, updatedAt }`, `BuildRunStatus = planning|awaiting_approval|running|integrating|reviewing|done|failed|aborted`. (Implementer: confirm the hook export name, likely `useBuildRunsStore`.)
- AgentRoster `ProjectGroupHeader` primary action currently calls `setActive(pmAgentId)`.
- e2e seeds the COO agent but **not** a project, so populated-dashboard e2e isn't reliable in the sandbox — tests cover the index + navigation wiring; the populated dashboard is verified by build + manual.

---

## File Structure

- `packages/web/src/components/agents/ProjectsView.tsx` — `export` the `ProjectCard` component; convert the default `ProjectsView` into a **project index** (list of project name cards → `onOpenProject`, plus "New coding team").
- `packages/web/src/components/agents/ProjectDashboard.tsx` — **new**: header + reused `ProjectCard` + `ProjectBuildRuns` card; `onChatPM` / `onOpenBuilds` / `onOpenSettings` props.
- `packages/web/src/components/agents/ProjectBuildRuns.tsx` — **new**: recent build runs summary for one project (from `build-runs-store`), "Open in Build Runs" link.
- `packages/web/src/components/agents/AgentRoster.tsx` — project group header → `onOpenProject(projectId)` (new prop) instead of `setActive(pm)`.
- `packages/web/src/App.tsx` — `selectedProjectId` state; `openProject(id)`; `view: "project"` render; wire AgentRoster + ProjectsView index + ⌘K.
- `packages/web/src/lib/commands.ts` — add `projects` + `openProject` to `CommandContext`; emit "Open project <name>" commands.
- `packages/web/e2e/10-projects.spec.ts` — **new**: project index + ⌘K "Go to Projects".

---

## Task 1: ProjectBuildRuns card + export ProjectCard

**Files:**
- Modify: `packages/web/src/components/agents/ProjectsView.tsx` (export `ProjectCard`)
- Create: `packages/web/src/components/agents/ProjectBuildRuns.tsx`

- [ ] **Step 1: Export ProjectCard**

In `ProjectsView.tsx`, change `function ProjectCard(` to `export function ProjectCard(`. No other change to it.

- [ ] **Step 2: Confirm the build-runs store API**

Read `packages/web/src/stores/build-runs-store.ts`. Confirm the hook name and that it exposes `runsByProject: Record<string, BuildRunSummary[]>`, `loadForProject(projectId)`, and `bindSocket()`, and the `BuildRunSummary` type export. Use the real names in Step 3.

- [ ] **Step 3: Create ProjectBuildRuns.tsx**

Create `packages/web/src/components/agents/ProjectBuildRuns.tsx` (adjust the store hook/type names to what Step 2 found):

```tsx
import { useEffect } from "react";
import { GitPullRequest } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useBuildRunsStore, type BuildRunSummary } from "../../stores/build-runs-store";

const EMPTY: BuildRunSummary[] = [];

const STATUS_COLOR: Record<string, string> = {
  running: "rgb(var(--info))",
  integrating: "rgb(var(--info))",
  reviewing: "rgb(var(--info))",
  planning: "rgb(var(--muted))",
  awaiting_approval: "rgb(var(--warning))",
  done: "rgb(var(--success))",
  failed: "rgb(var(--danger))",
  aborted: "rgb(var(--muted))",
};

export function ProjectBuildRuns({
  projectId,
  onOpenBuilds,
}: {
  projectId: string;
  onOpenBuilds?: () => void;
}) {
  const runs = useBuildRunsStore((s) => s.runsByProject[projectId]) ?? EMPTY;
  const loadForProject = useBuildRunsStore((s) => s.loadForProject);
  const bindSocket = useBuildRunsStore((s) => s.bindSocket);

  useEffect(() => {
    bindSocket();
    void loadForProject(projectId);
  }, [projectId, loadForProject, bindSocket]);

  return (
    <div
      data-testid="project-build-runs"
      style={{
        border: "1px solid rgb(var(--border))",
        borderRadius: 12,
        padding: 12,
        background: "rgb(var(--surface))",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Build runs</span>
        <span style={{ flex: 1 }} />
        {onOpenBuilds && (
          <button
            onClick={onOpenBuilds}
            style={{
              background: "transparent",
              border: "none",
              color: "rgb(var(--accent))",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Open in Build Runs ▸
          </button>
        )}
      </div>
      {runs.length === 0 && (
        <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>No build runs yet.</span>
      )}
      {runs.slice(0, 6).map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            padding: "6px 0",
            borderTop: "1px solid rgb(var(--border))",
          }}
        >
          <span style={{ color: STATUS_COLOR[r.status] ?? "rgb(var(--fg))", fontWeight: 700 }}>
            {r.status}
          </span>
          <span
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {r.goal}
          </span>
          {r.prUrl && (
            <a
              href={r.prUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "rgb(var(--accent))", display: "inline-flex", alignItems: "center", gap: 3 }}
            >
              <Icon icon={GitPullRequest} size={13} /> {r.prNumber ? `#${r.prNumber}` : "PR"}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @otterbot/web build` → success.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/agents/ProjectsView.tsx packages/web/src/components/agents/ProjectBuildRuns.tsx
git commit -m "feat(web): ProjectBuildRuns summary card + export ProjectCard"
```

---

## Task 2: ProjectDashboard + navigation wiring (replace flat ProjectsView)

**Files:**
- Create: `packages/web/src/components/agents/ProjectDashboard.tsx`
- Modify: `packages/web/src/components/agents/ProjectsView.tsx` (→ index)
- Modify: `packages/web/src/components/agents/AgentRoster.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/lib/commands.ts`

- [ ] **Step 1: Create ProjectDashboard.tsx**

Create `packages/web/src/components/agents/ProjectDashboard.tsx`:

```tsx
import { useEffect } from "react";
import { MessageSquare } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore } from "../../stores/projects-store";
import { useAgentsStore } from "../../stores/agents-store";
import { ProjectCard } from "./ProjectsView";
import { ProjectBuildRuns } from "./ProjectBuildRuns";

export function ProjectDashboard({
  projectId,
  onChatPM,
  onOpenBuilds,
  onOpenSettings,
}: {
  projectId: string | null;
  onChatPM?: (agentId: string) => void;
  onOpenBuilds?: () => void;
  onOpenSettings?: (tab?: string) => void;
}) {
  const projects = useProjectsStore((s) => s.projects);
  const load = useProjectsStore((s) => s.load);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  const bindSocket = useProjectsStore((s) => s.bindSocket);
  const remove = useProjectsStore((s) => s.remove);
  const agents = useAgentsStore((s) => s.agents);

  useEffect(() => {
    void load();
    void loadForgeAccounts();
    bindSocket();
  }, [load, loadForgeAccounts, bindSocket]);

  const project = projects.find((p) => p.id === projectId) ?? null;

  if (!project) {
    return (
      <div style={{ padding: 24, color: "rgb(var(--muted))", fontSize: 13 }} data-testid="project-dashboard-empty">
        Select a project from the sidebar to see its dashboard.
      </div>
    );
  }

  const pmId = project.team.find((t) => t.role === "pm")?.agentId ?? null;
  const teamAgents = project.team
    .map((t) => agents.find((a) => a.id === t.agentId))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <div data-testid="project-dashboard" style={{ height: "100%", overflowY: "auto", padding: 20 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 12, background: "rgb(var(--surface-elevated))",
            display: "grid", placeItems: "center", fontSize: 18,
          }}
        >
          🦦
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{project.name}</h2>
          <div style={{ fontSize: 12, color: "rgb(var(--muted))", marginTop: 2 }}>
            {project.repos.length} repo{project.repos.length === 1 ? "" : "s"} · {project.team.length} agents · {project.mode}
          </div>
        </div>
        <div style={{ display: "flex" }}>
          {teamAgents.map((a, i) => (
            <span
              key={a.id}
              title={a.displayName}
              style={{
                width: 28, height: 28, borderRadius: "50%", marginLeft: i === 0 ? 0 : -8,
                border: "2px solid rgb(var(--bg))", background: "rgb(var(--surface-elevated))",
                display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800,
              }}
            >
              {a.displayName.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        {pmId && onChatPM && (
          <button
            data-testid="dashboard-chat-pm"
            onClick={() => onChatPM(pmId)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px",
              borderRadius: 10, border: "1px solid rgb(var(--border))", background: "rgb(var(--surface))",
              color: "rgb(var(--fg))", cursor: "pointer", fontSize: 12, fontWeight: 700,
            }}
          >
            <Icon icon={MessageSquare} size={14} /> Chat with PM
          </button>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <ProjectBuildRuns projectId={project.id} onOpenBuilds={onOpenBuilds} />
        <ProjectCard project={project} onDelete={() => remove(project.id)} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Convert ProjectsView into a project index**

Replace the body of `ProjectsView` (the `return (...)`) so it lists projects as clickable cards that call `onOpenProject`, keeps the "New coding team" button, and no longer renders the full `ProjectCard` editors. Update its props to `{ onOpenProject }`:

```tsx
export function ProjectsView({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const error = useProjectsStore((s) => s.error);
  const load = useProjectsStore((s) => s.load);
  const bindSocket = useProjectsStore((s) => s.bindSocket);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    void load();
    bindSocket();
  }, [load, bindSocket]);

  return (
    <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon icon={FolderGit2} size={18} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Projects</h2>
      </div>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, maxWidth: 680, marginTop: 0 }}>
        Pick a project to open its dashboard, or start a new coding team.
      </p>
      <div style={{ margin: "16px 0" }}>
        <button data-testid="new-coding-team" style={primaryBtn} onClick={() => setWizardOpen(true)}>
          <Icon icon={Plus} size={14} /> New coding team
        </button>
      </div>
      {error && <div style={{ color: "rgb(var(--danger))", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {wizardOpen && <AgentWizard initialChoice="team" onClose={() => setWizardOpen(false)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 680 }}>
        {projects.length === 0 && (
          <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>No projects yet.</div>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            data-testid={`project-index-${p.id}`}
            onClick={() => onOpenProject(p.id)}
            style={{ ...card, maxWidth: 680, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
          >
            <Icon icon={FolderGit2} size={16} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
            <span style={badge}>{p.repos.length} repo{p.repos.length === 1 ? "" : "s"}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>{p.team.length} agents ▸</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

Keep the `RepoRow`, `ProjectCard`, `RunRow` definitions and the style consts in this file (ProjectCard is now reused by the dashboard). Remove now-unused imports if any (e.g. if `remove`/`loadForgeAccounts` are no longer used by the index — they moved to ProjectDashboard; verify with the build).

- [ ] **Step 3: AgentRoster — project header opens the dashboard**

In `AgentRoster.tsx`, add an `onOpenProject?: (projectId: string) => void` prop. Find where `ProjectGroupHeader`'s primary click calls `setActive(pmAgentId)` and change that primary action to `onOpenProject?.(project.id)`. (Keep the expand/collapse chevron behavior and the per-member `agent-card-*` selection unchanged — the PM is still reachable by clicking the PM's own card, and via the dashboard's "Chat with PM".) Thread `onOpenProject` from `AgentRoster` props down to `ProjectGroupHeader`.

- [ ] **Step 4: App.tsx wiring**

In `AuthedApp`:
- Add state: `const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);`
- Add helper: `const openProject = (id: string) => { setSelectedProjectId(id); setView("project"); };`
- Add `"project"` to the `MainView` type.
- Roster: `<AgentRoster onNewAgent={...} onOpenSettings={() => openSettings()} onOpenProject={openProject} />`
- Replace the `view === "projects"` render with the index using the new prop:
  `{view === "projects" && <ProjectsView onOpenProject={openProject} />}`
- Add the dashboard render:
  ```tsx
  {view === "project" && (
    <ProjectDashboard
      projectId={selectedProjectId}
      onChatPM={(id) => { setActive(id); setView("chat"); }}
      onOpenBuilds={() => setView("builds")}
      onOpenSettings={openSettings}
    />
  )}
  ```
- Import `ProjectDashboard`.
- Update the `commands` memo to pass projects + openProject (see Step 5).

- [ ] **Step 5: ⌘K — open a project from the palette**

In `lib/commands.ts`, extend `CommandContext` with `projects: { id: string; name: string }[]` and `openProject: (id: string) => void`, and in `buildCommands` add a `Navigation`-group command per project:

```ts
const projectCmds: Command[] = ctx.projects.map((p) => ({
  id: `project:${p.id}`,
  title: `Open project ${p.name}`,
  group: "Navigation",
  keywords: [p.name, "project"],
  run: () => ctx.openProject(p.id),
}));
```
Return them with the others (e.g. `[...agents, ...projectCmds, ...nav, ...actions]`). Update the existing `commands.test.ts` `ctx()` helper to include `projects: []` and `openProject: vi.fn()` so it compiles, and add one assertion that a project produces an `project:<id>` command. In `App.tsx`'s `buildCommands({...})` call, pass `projects: projects.map((p) => ({ id: p.id, name: p.name }))` and `openProject`. (Get `projects` in App from `useProjectsStore((s) => s.projects)` — add the import/selector; ensure projects are loaded, e.g. call its `load()` in the existing mount effect.)

- [ ] **Step 6: Build + unit**

Run: `pnpm --filter @otterbot/web build` → success.
Run: `pnpm --filter @otterbot/web exec vitest run src/lib/commands.test.ts` → pass (updated ctx + new assertion).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/agents/ProjectDashboard.tsx packages/web/src/components/agents/ProjectsView.tsx packages/web/src/components/agents/AgentRoster.tsx packages/web/src/App.tsx packages/web/src/lib/commands.ts packages/web/src/lib/commands.test.ts
git commit -m "feat(web): per-project dashboard; sidebar opens it; ⌘K open-project"
```

---

## Task 3: e2e + regression

**Files:**
- Create: `packages/web/e2e/10-projects.spec.ts`
- Verify existing specs

- [ ] **Step 1: Write e2e (sandbox-safe — no seeded project)**

Create `packages/web/e2e/10-projects.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("projects", () => {
  test("project index opens via ⌘K and offers a new team", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("command-trigger").click();
    await page.getByTestId("command-input").fill("Go to Projects");
    await page.getByTestId("command-input").press("Enter");
    await expect(page.getByTestId("new-coding-team")).toBeVisible();
  });
});
```

(The populated dashboard — sidebar project → `project-dashboard`, build-runs card, Chat-with-PM — requires a seeded project, which the sandbox e2e doesn't have; verify those manually per the Final verification.)

- [ ] **Step 2: Run e2e + confirm no regressions**

Run: `pnpm --filter @otterbot/web test:e2e e2e/01-shell.spec.ts e2e/07-command-palette.spec.ts e2e/08-studio-shell.spec.ts e2e/10-projects.spec.ts`
Expected: UI tests pass (note any backend-only `/api/*` failures in 01-shell as environmental). Confirm `grep -rn "view-" packages/web/e2e` is still clean and no spec references the removed flat ProjectsView behavior.

- [ ] **Step 3: Commit**

```bash
git add packages/web/e2e/10-projects.spec.ts
git commit -m "test(web): project index + open-project palette e2e"
```

---

## Final verification

- [ ] `pnpm --filter @otterbot/web build` and `pnpm --filter @otterbot/server build` → succeed.
- [ ] `pnpm --filter @otterbot/web test` → unit green (themes, commands incl. open-project).
- [ ] `pnpm --filter @otterbot/web test:e2e e2e/07-command-palette.spec.ts e2e/08-studio-shell.spec.ts e2e/10-projects.spec.ts` → pass.
- [ ] Manual (`pnpm dev`, with at least one project): clicking a project group in the sidebar opens its **dashboard** (header with name/repos/agents/avatars, a Build runs card, and the full project editor below); "Chat with PM" switches to the PM's chat; "Open in Build Runs" → BuildRunsView; ⌘K "Open project <name>" jumps to the dashboard; the Projects index (⌘K "Go to Projects") lists projects and "New coding team" works; editing repos/rules/team-models from the dashboard still saves.

## Not in this plan (later)

Deep restyle of `BuildRunsView` and the `ProjectCard` internals into Playful Pop cards (this plan reuses ProjectCard as-is); a project-scoped run/task board embedded in the dashboard (we link to BuildRunsView instead); deriving real "open PR" counts (header shows repos/agents, not PR counts, to avoid fabricated data).
