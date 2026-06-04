# The Studio — full UI redesign

**Date:** 2026-06-04
**Status:** Design approved (brainstorming), pending implementation plan
**Visual mockups:** `.superpowers/brainstorm/1757336-1780612573/content/` (HTML, viewable via the brainstorm companion server)

## Context

The current web UI is a competent but generic dark dashboard: a fixed 260px
agent-roster sidebar plus a 7-tab top nav (Chat, Agent Studio, Projects, Build
Runs, Activity, Network, Settings). Two complaints drove this redesign:

1. **Navigation structure** — the tab + roster + toggleable history/context
   panels model is awkward; secondary surfaces compete with the conversation.
2. **Generic identity** — it looks like any default dark admin app; nothing
   says "otterbot."

Otterbot is, conceptually, a small **AI company**: a COO coordinates PMs and
engineering pods, agents delegate over a bus, a pixel office visualizes them.
The redesign leans into that metaphor instead of fighting it. We explored three
divergent directions and chose **"The Studio"** (navigate your company by team &
channels) in a new **"Playful Pop"** identity. The goal is one cohesive design
language across the whole app, with navigation rebuilt around entities (agents,
channels, projects) and a single live "what's happening" surface.

This is a frontend-only redesign of `packages/web`. No server/API changes are
required; it re-skins and re-organizes existing data and views.

## Goals

- One design language across every surface (chat, projects, settings,
  onboarding, agent config, network, office, builds, activity).
- Replace the 7-tab nav with an **entity-centric sidebar + ⌘K command palette**.
- A distinctive identity ("Playful Pop") that reads as otterbot, using the
  existing logo.
- Collapse secondary "destinations" into contextual surfaces where natural.

## Non-goals

- No backend/API/data-model changes.
- No change to agent runtime, bus, scheduler, or coding-CLI behavior.
- Not removing the existing themes (Obsidian/Light/Forest) — Playful Pop is
  added as the new default; others remain selectable.

## Chosen direction: "The Studio"

Navigate the app by your company, not by abstract tabs.

- **Left sidebar = the org**: grouped *Leadership* (COO), *Channels*, *Projects*
  (expandable pods of PM + engineers), *Direct messages*. A ⌘K search sits at
  the top.
- **Center = context**: a channel/DM conversation, OR a project dashboard, OR a
  full-page settings/profile/network view — whatever the selected entity needs.
- **Bottom = one live floor**: a full-width "office" strip showing each agent as
  a live station (avatar + status + progress). This is the single
  what's-happening surface; it absorbs the old Activity rail.

### Information architecture — old → new

| Today's view | New home |
|---|---|
| Chat | Channels & DMs in the left sidebar (primary surface) |
| Agent Studio | **Agent profile** page (top tabs), opened from an agent |
| Projects | *Projects* section in sidebar → project pod dashboard |
| Build Runs | Inside the project dashboard; drill to build-run detail |
| Activity | Bottom **office floor** (glance) + full **Activity** feed |
| Network | **Company** view: Org chart · Permissions · Office subtabs |
| Settings | Full-page, **tabs across the top**, from the gear by your name |
| (new) | **⌘K command palette** — jump to any agent/channel/project/action |

## Design language — "Playful Pop"

A vivid, rounded, characterful dark theme. Distinct from the bluish-gray
Obsidian default.

**Palette (RGB triples, to match `index.css` convention):**

```
--bg            18 19 39      (#121327 deep indigo-slate)
--surface       26 28 56      (#1a1c38)
--surface-elev  36 38 74      (#24264a)
--border        48 51 106     (#30336a)
--fg            238 240 255   (#eef0ff)
--muted         154 160 207   (#9aa0cf)
--subtle        106 111 160   (#6a6fa0)
--accent (teal) 61 215 196    (#3dd7c4)   primary
--accent-2 (coral) 255 122 102 (#ff7a66)  secondary / gradient partner
--success       61 215 196
--warning       255 200 97    (#ffc861 amber)
--danger        255 122 102
--info          122 162 240   (#7aa2f0)
agent palette: teal, coral, amber, blue(#7aa2f0), purple(#c08bf0), rose(#ff8fb0)
on-accent text: #0a1024
```

- **Signature gradient**: `linear-gradient(135deg, teal, coral)` — used on the
  logo tile, primary buttons, send button, active stepper node.
- **Radius**: larger and rounder than today — 10–18px (cards 14–15, modals/shell
  18, inputs/pills 10–12).
- **Typography**: keep Geist + JetBrains Mono. Slightly bolder headings (800).
- **Status colors**: working=teal, planning/thinking=amber, queued/idle=subtle,
  error=coral.
- **Logo**: existing `public/logo.jpeg` (otter-at-laptop medallion) as the brand
  mark in the nav, rounded-square at ~32–34px. Pairs naturally with the indigo
  palette. Approved as-is (no circle crop).

**Implementation:** add Playful Pop to the `THEMES` object in
`stores/global-settings-store.ts` and the `:root` variables in `index.css`; make
it the default. Because the codebase already drives color via CSS variables, the
re-skin is largely additive. Layout/IA changes are the larger work.

## Surface specs

Each references its approved mockup file under the brainstorm `content/` dir.

### 1. App shell + daily surface (`studio-v4-unified.html`)

- Grid: `250px | 1fr` columns; rows `1fr | 76px` (floor).
- **Left nav** (`AgentRoster.tsx` rework): brand (logo + workspace), ⌘K search,
  sections (Leadership / Channels / Projects / DMs), footer = user + gear.
  Active item uses the teal left-bar + gradient wash.
- **Center** (`chat/AgentChat.tsx`): channel header (name, "N agents working"
  pill, tools), message feed with avatar + name + role badge, **inline work
  cards** for live coding sessions, right-aligned user bubbles with the subtle
  gradient, composer with `@mention` hint. Max message width ~780px.
- **Bottom office floor** (full width under center): per-agent live *stations*
  (avatar + status + progress bar); idle agents dimmed; "Open office ▸".
  This replaces the old right-hand Activity/Pulse rail (which was removed for
  wasting space — decision: **no persistent right rail**).

### 2. Projects + Build Runs (`studio-v4-projects.html`)

Selecting a project swaps the center to a **pod dashboard**: header (icon, "N
repos · N PRs · sprint", stacked team avatars, Settings + New PR), and cards for
**Repos** (branch chip, PR count, build-status dot — multi-repo), **Pod** (team
members with role + coding-model preset), and **Build runs** (status glyph,
commit msg, branch·agent, duration). Maps to `ProjectsView.tsx` +
`BuildRunsView.tsx`.

### 3. Build run detail (`more-screens.html` §3)

Header (back, title, branch·agent·#, running pill, Re-run) → two columns:
**stages** list (Checkout ✓ → Test ● → Deploy queued, with durations) +
**terminal** panel streaming colored log output with a blinking cursor.

### 4. Settings — full-page top tabs (`settings-layouts.html` V2, chosen)

Reached from the gear by the user name. Nav stays; center shows a title + a
**horizontal tab bar** (Models & Providers · Coding CLIs · Coding Models ·
Integrations · Appearance · Account) + content. Integrations renders **Accounts**
as status cards and **Bindings** as account→agents rows, mirroring the real
Integrations model (accounts + bindings in `control.db`). Maps to
`settings/GlobalSettings.tsx` (switch its internal layout to top tabs). The
modal variant (V1) was considered and rejected.

### 5. Onboarding (`onboarding.html`)

Framed as **"hire your COO."** Step 1: welcome — big logo on a teal/coral
gradient, capability chips, "Hire my COO →". Step 2+: stepper (Welcome ✓ → Your
COO → Model → Done); the COO step has name + avatar-color, role, and a
**Personality** field that maps to `SOUL.md`; later steps pick provider/model.
Maps to `OnboardingWizard.tsx` (and shares patterns with `AgentWizard.tsx` for
"hire new agent").

### 6. Agent profile (`profile-and-network.html`, top section)

Replaces the 9-tab `AgentStudio.tsx`. **Profile header** (big avatar + status,
name, role, badges: status / model / skill count / "coordinates N", Chat +
Reset) + **top tabs**: Persona · Model · Skills · Peers · Schedule · Memory ·
Integrations. (Identity folds into the header; Credentials → Integrations.)
Persona tab = name/role + `SOUL.md` editor + trait chips + a **live preview**
card showing how the agent presents/greets.

### 7. Company / Network (`profile-and-network.html`, bottom section)

`NetworkView.tsx` gains subtabs **Org chart · Permissions · Office**. The org
chart renders the company as a tree (You → COO → PM/pods → engineers + standalone
agents); edges = reports-to / can-delegate, i.e. the permission model made
legible. Permissions keeps the existing editable graph; Office embeds the floor.

### 8. Full office (`more-screens.html` §2)

The expanded PixiJS office (`agents/office/PixiOffice.tsx`) reskinned to Playful
Pop: zoned floor (Leadership / project pods / Engineering / Research), agent
sprites at lit desks, status bubbles, idle agents dimmed. (Note: per project
memory, Kenney tiles are downloaded but the ART map is unmapped — sprite styling
here is the CSS/fallback aesthetic; mapping real tiles is separate.)

### 9. ⌘K command palette (`more-screens.html` §1) — new

Overlay launcher: search input → grouped results (Agents, Channels & Projects,
Actions) with the first result highlighted and keyboard hints (↑↓ / ↵ / ⌘↵ run
in background / esc). This is what makes deleting the 7-tab nav viable — it's the
primary "jump to anything." New component, wired to the agents/projects/channels
stores and an action registry.

### 10. Activity / message bus (`more-screens.html` §4)

Full `ActivityView.tsx` feed: from→to avatar pairs, message text,
delegation/report/subagent **tags**, indented subagent spawns, filter chips
(All / Delegations / Reports / Subagents), live indicator. The bottom office
floor is the glanceable summary; this is the full history.

## Components to modify / add

Reuse existing `ui/` primitives (`Button`, `Card`, `Badge`, `Tabs`, `Icon`),
restyled by the new tokens. Major touch points:

- `App.tsx` — replace 7-tab nav with entity sidebar + center router + floor.
- `index.css`, `stores/global-settings-store.ts` — add Playful Pop theme/tokens.
- `agents/AgentRoster.tsx` — company-grouped nav (Leadership/Channels/Projects/DMs).
- `chat/AgentChat.tsx`, `ConversationList.tsx`, `ContextPanel.tsx` — channel
  surface; context panel becomes a header affordance, not a column.
- `agents/AgentStudio.tsx` → agent **profile** (header + top tabs).
- `agents/ProjectsView.tsx`, `BuildRunsView.tsx` — pod dashboard + run detail.
- `agents/ActivityView.tsx` — bottom floor (stations) + full activity feed.
- `agents/NetworkView.tsx` — Org chart subtab (new) + existing graph + office.
- `agents/office/PixiOffice.tsx` — reskin to Playful Pop.
- `settings/GlobalSettings.tsx` — top-tab layout.
- `agents/OnboardingWizard.tsx` / `AgentWizard.tsx` — "hire" framing + new look.
- **New:** `CommandPalette.tsx` (⌘K) + a lightweight action registry.

## Suggested phasing (for the implementation plan)

1. **Theme foundation** — add Playful Pop tokens to `index.css` +
   `global-settings-store.ts`; set as default. App still works, new colors.
2. **Shell + nav** — rebuild `App.tsx` shell (sidebar/center/floor),
   company-grouped roster, ⌘K palette. Biggest structural change.
3. **Primary surfaces** — chat channel surface + office floor; project pod
   dashboard + build-run detail.
4. **Config surfaces** — settings (top tabs), agent profile, onboarding.
5. **Company + office** — org chart subtab, activity feed, PixiOffice reskin.

## Resolved decisions

- **Channels vs DMs** — channels are a **navigation/grouping reskin over today's
  conversations**, not a new multi-agent-room data concept. No server/data
  changes needed for v1.
- **Default theme** — Playful Pop becomes the **default outright** (legacy
  Obsidian/Light/Forest remain selectable in Appearance).
- **⌘K scope** — ship the **full skeleton**: navigation *and* an action registry
  with verbs ("start build", "hire agent", "new conversation", "open settings").
  Get the structure in so actions are easy to add/tweak; the v1 action set can be
  small but the registry is first-class.

## Verification

- `pnpm --filter @otterbot/web build` and `pnpm dev`; click through each
  surface against its mockup.
- `pnpm --filter @otterbot/web test:e2e` (Playwright) — update selectors changed
  by the nav restructure; add coverage for ⌘K and the new shell.
- Manual: theme switch still works (Playful Pop + legacy themes); logo renders;
  keyboard nav for ⌘K; responsive behavior of the 250px sidebar.
