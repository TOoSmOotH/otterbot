# The Studio — Sidebar IA + Channel Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the day-to-day surface into "The Studio": a company-grouped left sidebar (Leadership / Projects / Direct messages) with a settings gear footer, a chat header that reads as a channel/room (agent name + status), and retirement of the 7-tab top nav (navigation now flows through the sidebar, the ⌘K palette, the settings gear, and the office floor).

**Architecture:** Builds on the shipped skeleton (Playful Pop theme, ⌘K palette, office floor). Reskins/relabels the existing `AgentRoster` grouping (which already partitions COO / top-level / project pods — we keep that logic and add section headers + a gear footer), restyles the `AgentChat` header into a channel header, and removes the visible top-tab `<nav>` from `App.tsx` while KEEPING the `VIEWS` array and all view rendering (the palette still routes to them). No backend/data changes: "channels" = grouping over per-agent conversations; there is no multi-agent room data.

**Tech Stack:** React 19 + Vite, Zustand, CSS variables (Playful Pop tokens), lucide-react, Playwright e2e. Inline styles are the established pattern — keep using them.

**Spec:** `docs/superpowers/specs/2026-06-04-studio-ui-redesign-design.md`. Visual ref: `.superpowers/brainstorm/1757336-1780612573/content/studio-v4-unified.html`.

**Preserve these data-testids (e2e depends on them):** `agent-card-<id>`, `agent-card-coo`, `project-group-<id>`, `project-group-toggle-<id>`, `new-agent`, `message-list`, `chat-input`, `chat-send`, `conversation-list`, `context-panel`, `command-trigger`, `office-floor`, `floor-station-coo`, `global-settings`.

---

## File Structure

- `packages/web/src/components/agents/AgentRoster.tsx` — add section headers (Leadership / Projects / Direct messages) and a footer with the user + a settings **gear** button; accept an `onOpenSettings` prop. Keep the existing grouping logic, `AgentCard`, `ProjectGroupHeader`, and all testids.
- `packages/web/src/components/chat/AgentChat.tsx` — restyle the header into a channel header (room-style name + status pill). Keep the History/Context/Edit/New-conversation buttons, the panels, and all testids.
- `packages/web/src/App.tsx` — remove the visible 7-tab `<nav>` bar; pass `onOpenSettings={openSettings}` to `AgentRoster`; keep `VIEWS`, the `command-trigger` button (relocated into the thin top strip or sidebar), the ⌘K palette, view rendering, and the office floor.
- `packages/web/e2e/01-shell.spec.ts` — update the "main views switch" test to navigate via ⌘K + the sidebar gear instead of the removed `view-*` tabs.
- `packages/web/e2e/08-studio-shell.spec.ts` — **new**: assert the sidebar sections, the gear opens settings, and the channel header renders.

---

## Task 1: Company-grouped sidebar + settings gear footer

**Files:**
- Modify: `packages/web/src/components/agents/AgentRoster.tsx`
- Modify: `packages/web/src/App.tsx` (pass the new prop)
- Test: `packages/web/e2e/08-studio-shell.spec.ts` (created here, extended in Task 2/3)

- [ ] **Step 1: Read the current AgentRoster**

Read `packages/web/src/components/agents/AgentRoster.tsx` in full. Note: it already computes `{ coo, topLevel, groups }` via a `useMemo`, renders the COO card, then top-level agent cards, then collapsible project groups, and has a footer with the `new-agent` button. Note its existing props (currently `{ onNewAgent }`).

- [ ] **Step 2: Add an `onOpenSettings` prop**

Change the component's props type to add `onOpenSettings?: () => void`:

```tsx
export function AgentRoster({
  onNewAgent,
  onOpenSettings,
}: {
  onNewAgent: () => void;
  onOpenSettings?: () => void;
}) {
```

- [ ] **Step 3: Add section header labels**

Add a tiny presentational section-label element and place one above each group. Define near the top of the file (module scope, after imports):

```tsx
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        color: "rgb(var(--subtle))",
        fontWeight: 700,
        margin: "13px 8px 6px",
      }}
    >
      {children}
    </div>
  );
}
```

In the scrollable list, wrap the existing renders with labels:
- Immediately before the COO card: `{coo && <SectionLabel>Leadership</SectionLabel>}`
- Immediately before the project groups: `{groups.length > 0 && <SectionLabel>Projects</SectionLabel>}`
- Immediately before the top-level agents: `{topLevel.length > 0 && <SectionLabel>Direct messages</SectionLabel>}`

Keep the existing card/group rendering and all testids unchanged. (Order in the mock is Leadership → Channels → Projects → DMs; we have no channel data, so the v1 order is Leadership → Projects → Direct messages.)

- [ ] **Step 4: Add the user + gear footer**

The footer currently holds the `new-agent` button. Restructure it so it has two rows (keep `new-agent` exactly as-is for testids), and ADD a row with the user identity and a settings gear. Import `Settings` from lucide-react if not already imported, and `Icon` from `../ui/Icon` (already used in the file — verify). Add, as the LAST element of the footer container:

```tsx
<button
  data-testid="sidebar-gear"
  onClick={() => onOpenSettings?.()}
  title="Settings"
  style={{
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    marginTop: 8,
    padding: "8px 10px",
    background: "transparent",
    border: "1px solid rgb(var(--border))",
    borderRadius: 10,
    color: "rgb(var(--muted))",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  }}
>
  <Icon icon={Settings} size={15} />
  Settings
</button>
```

- [ ] **Step 5: Pass the prop from App.tsx**

In `packages/web/src/App.tsx`, update the roster render:

```tsx
<AgentRoster onNewAgent={() => setCreateOpen(true)} onOpenSettings={() => openSettings()} />
```

(`openSettings` already exists in `AuthedApp`.)

- [ ] **Step 6: Write the e2e test**

Create `packages/web/e2e/08-studio-shell.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("studio shell", () => {
  test("sidebar shows company sections and the COO under Leadership", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByText("Leadership", { exact: true })).toBeVisible();
    await expect(page.getByTestId("agent-card-coo")).toBeVisible();
  });

  test("settings gear opens settings", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("sidebar-gear").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();
  });
});
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @otterbot/web build` → success.
Run: `pnpm --filter @otterbot/web test:e2e e2e/08-studio-shell.spec.ts` → 2 pass.
Run: `pnpm --filter @otterbot/web test:e2e e2e/01-shell.spec.ts` → the existing UI tests (app loads, office floor) still pass; the `/api/*` tests may fail if no backend is running (environmental — note it).

- [ ] **Step 8: Commit** (no Co-Authored-By trailer)

```bash
git add packages/web/src/components/agents/AgentRoster.tsx packages/web/src/App.tsx packages/web/e2e/08-studio-shell.spec.ts
git commit -m "feat(web): company-grouped sidebar sections + settings gear"
```

---

## Task 2: Chat-as-channel header

**Files:**
- Modify: `packages/web/src/components/chat/AgentChat.tsx`
- Test: `packages/web/e2e/08-studio-shell.spec.ts` (extend)

- [ ] **Step 1: Read the current header**

Read `packages/web/src/components/chat/AgentChat.tsx` lines ~152-214 (the `<header>`). It shows the agent `displayName`, a status dot, a streaming indicator, and the IconButtons (History/Context/Edit/New conversation). Keep all of that and its behavior.

- [ ] **Step 2: Restyle into a channel header**

Replace the header's left-side title block so the agent reads as a room: a `#`-style prefix glyph + the display name (bold), and a **status pill** showing the agent's current status (not a fake "N working" — this is a single agent). Keep the existing buttons on the right untouched. Concretely, wrap the name in a channel-style layout and add the pill. Example for the left block (adapt names to the existing variables in the file — `agent.displayName`, `agent.status`):

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
  <h2 data-testid="channel-title" style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
    <span style={{ color: "rgb(var(--subtle))", fontWeight: 700, marginRight: 4 }}>#</span>
    {agent.displayName}
  </h2>
  <span
    style={{
      fontSize: 11,
      fontWeight: 700,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 9px",
      borderRadius: 20,
      color:
        agent.status === "working" || agent.status === "thinking"
          ? "rgb(var(--success))"
          : "rgb(var(--muted))",
      background:
        agent.status === "working" || agent.status === "thinking"
          ? "rgba(61,215,196,0.1)"
          : "rgb(var(--surface-elevated))",
    }}
  >
    {agent.status}
  </span>
</div>
```

Keep the existing streaming indicator and the right-hand IconButton group exactly as they are. Do not remove the existing status dot if you prefer to keep it — but the new pill is the primary status affordance; avoid duplicating the same info twice (drop the old standalone dot if it now reads redundant). Preserve `message-list`, `chat-input`, `chat-send`, and the History/Context toggles + their testids.

- [ ] **Step 3: Extend the e2e**

Add to `packages/web/e2e/08-studio-shell.spec.ts` inside the `describe`:

```ts
  test("chat shows a channel-style header for the active agent", async ({ page }) => {
    await gotoApp(page);
    // The COO is auto-active; the chat surface is the default view.
    await expect(page.getByTestId("channel-title")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
  });
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @otterbot/web build` → success.
Run: `pnpm --filter @otterbot/web test:e2e e2e/08-studio-shell.spec.ts` → 3 pass.
Run: `pnpm --filter @otterbot/web test:e2e e2e/02-chat.spec.ts` → still passes (chat send/stream behavior unchanged; if it needs a backend, note any environmental failures).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/AgentChat.tsx packages/web/e2e/08-studio-shell.spec.ts
git commit -m "feat(web): channel-style chat header"
```

---

## Task 3: Retire the 7-tab nav

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/e2e/01-shell.spec.ts`

- [ ] **Step 1: Read App.tsx**

Re-read `packages/web/src/App.tsx`. The right column contains a `<nav>` (lines ~155-227) holding the `command-trigger` button + a `LayoutGroup` of `view-<id>` tab buttons, then the view container (`{view === ... }`), then `<OfficeFloor/>`. We will remove the tab buttons but KEEP: the `command-trigger`, the `VIEWS` array (used by `buildCommands`), the view container, and the office floor.

- [ ] **Step 2: Replace the nav bar with a thin top strip**

Replace the entire `<nav>...</nav>` block with a slim top strip that keeps only the `command-trigger` (so ⌘K stays clickable) — drop the `LayoutGroup` and the `view-<id>` buttons and the now-unused `motion`/`LayoutGroup` imports if they are no longer referenced elsewhere (check first; remove only if unused). Example replacement:

```tsx
<div
  style={{
    display: "flex",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid rgb(var(--border))",
    background: "rgb(var(--bg))",
  }}
>
  <button
    data-testid="command-trigger"
    onClick={() => setPaletteOpen(true)}
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      background: "rgb(var(--surface))",
      border: "1px solid rgb(var(--border))",
      borderRadius: 10,
      color: "rgb(var(--subtle))",
      cursor: "pointer",
      fontSize: 12,
    }}
  >
    Jump to… <kbd style={{ fontSize: 10 }}>⌘K</kbd>
  </button>
</div>
```

Leave the view container (`{view === "chat" && ...}` etc.) and `<OfficeFloor/>` exactly as they are. Navigation now happens via: the sidebar (selecting an agent → chat), the sidebar gear (→ settings), the office floor "Open office ▸" (→ network), and ⌘K (→ any view: chat/studio/projects/builds/activity/network/settings).

- [ ] **Step 3: Confirm no dangling references**

After removing the tab buttons, ensure `view`/`setView` are still used (they are — by the view container and `buildCommands`). Remove the `motion` and `LayoutGroup` imports from `motion/react` ONLY if grep shows no other usage in the file. Run `pnpm --filter @otterbot/web build` and fix any unused-import / type errors.

- [ ] **Step 4: Update the shell e2e for the new navigation**

In `packages/web/e2e/01-shell.spec.ts`, the "main views switch" test currently clicks `view-activity`, `view-chat`, `view-settings`. Replace its body to navigate via ⌘K and the gear instead:

```ts
  test("main views switch", async ({ page }) => {
    await gotoApp(page);

    // Settings via the sidebar gear
    await page.getByTestId("sidebar-gear").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();

    // Back to chat via the command palette
    await page.getByTestId("command-trigger").click();
    await page.getByTestId("command-input").fill("Go to Chat");
    await page.getByTestId("command-input").press("Enter");
    await expect(page.getByTestId("chat-input")).toBeVisible();
  });
```

(Confirm `buildCommands` produces a "Go to Chat" navigation command — it does: nav commands are titled `Go to <label>` and "Chat" is a VIEWS label.)

- [ ] **Step 5: Verify**

Run: `pnpm --filter @otterbot/web build` → success.
Run: `pnpm --filter @otterbot/web test:e2e e2e/01-shell.spec.ts e2e/07-command-palette.spec.ts e2e/08-studio-shell.spec.ts` → all UI tests pass (note any `/api/*` environmental failures in 01-shell). Confirm there are no remaining references to `view-` testids in the suite (`grep -rn "view-" packages/web/e2e` should only match unrelated strings, if any).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/e2e/01-shell.spec.ts
git commit -m "feat(web): retire 7-tab nav; route via sidebar, gear, palette, floor"
```

---

## Final verification

- [ ] `pnpm --filter @otterbot/web test` → unit suites still green (themes, commands).
- [ ] `pnpm --filter @otterbot/web test:e2e e2e/01-shell.spec.ts e2e/02-chat.spec.ts e2e/07-command-palette.spec.ts e2e/08-studio-shell.spec.ts` → UI tests pass (backend-dependent `/api/*` and chat-send tests may fail only if no backend; confirm failures are limited to those).
- [ ] `pnpm --filter @otterbot/web build` and `pnpm --filter @otterbot/server build` → succeed.
- [ ] Manual (`pnpm dev`): the sidebar shows Leadership / Projects / Direct messages with a Settings gear at the bottom; selecting an agent shows the channel-style chat header with a status pill; there is no top-tab bar; settings open from the gear; the office floor and ⌘K still work; the legacy views (projects/builds/activity/network/studio) are still reachable via ⌘K.

## Not in this plan (later plans)

A real multi-agent **channel/room** data model (currently every conversation is per-agent); the **project pod dashboard** + **build-run detail** (clicking a project still opens the PM's chat for now); **agent profile** page replacing Agent Studio; **org chart** subtab; **PixiOffice** reskin; onboarding "hire your COO" reflow; the full **Activity** feed restyle.
