# The Studio — Shell Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the structural "bone" of the redesign — the Playful Pop theme as default, a ⌘K command palette backed by a first-class action registry, and the signature bottom office floor — layered additively over the existing shell so the app keeps working and we can start tweaking.

**Architecture:** Additive, low-risk first pass. We do NOT yet rebuild the sidebar IA, chat channel surface, or settings layout (those are later plans). This plan: (1) adds a new theme via the existing CSS-variable theme system and makes it default; (2) adds a pure, unit-tested command/action registry plus a CommandPalette overlay wired to ⌘K and a nav trigger; (3) adds an OfficeFloor strip to the shell bottom. The existing 7-tab nav and views stay intact so nothing breaks.

**Tech Stack:** React 19 + Vite, Zustand stores, CSS variables for theming, lucide-react icons, Vitest (web unit tests, `--passWithNoTests`), Playwright (e2e, self-contained fake model).

**Spec:** `docs/superpowers/specs/2026-06-04-studio-ui-redesign-design.md`. Visual reference: `.superpowers/brainstorm/1757336-1780612573/content/` (esp. `studio-v4-unified.html`, `more-screens.html` §1).

---

## File Structure

- `packages/shared/src/settings.ts` — add `"playful"` to the `ThemeId` union.
- `packages/web/src/lib/themes.ts` — **new**: extract `THEMES` + `applyTheme` + add the Playful Pop palette. One focused, import-safe (no DOM at import time) module so it's unit-testable without pulling in the store's socket deps.
- `packages/web/src/stores/global-settings-store.ts` — re-export from `lib/themes`; change default theme to `playful`.
- `packages/web/src/index.css` — set `:root` defaults to Playful Pop (first-paint match).
- `packages/server/src/orchestrator/orchestrator.ts:238` — server default theme → `playful`.
- `packages/web/src/lib/commands.ts` — **new**: command/action registry (`Command`, `CommandContext`, `buildCommands`, `filterCommands`). Pure logic.
- `packages/web/src/lib/commands.test.ts` — **new**: Vitest unit tests for the registry.
- `packages/web/src/components/CommandPalette.tsx` — **new**: the ⌘K overlay UI.
- `packages/web/src/components/agents/OfficeFloor.tsx` — **new**: bottom live-stations strip.
- `packages/web/src/App.tsx` — wire ⌘K + palette + a nav trigger button; mount OfficeFloor at the shell bottom.
- `packages/web/e2e/07-command-palette.spec.ts` — **new**: e2e for ⌘K + navigation.
- `packages/web/e2e/01-shell.spec.ts` — extend with an office-floor assertion.

---

## Task 1: Playful Pop theme (default)

**Files:**
- Modify: `packages/shared/src/settings.ts:3`
- Create: `packages/web/src/lib/themes.ts`
- Modify: `packages/web/src/stores/global-settings-store.ts:1-119`
- Modify: `packages/web/src/index.css:9-46`
- Modify: `packages/server/src/orchestrator/orchestrator.ts:238`
- Test: `packages/web/src/lib/themes.test.ts`

- [ ] **Step 1: Add the theme id to shared types**

In `packages/shared/src/settings.ts`, change line 3:

```ts
export type ThemeId = "obsidian" | "light" | "forest" | "playful";
```

- [ ] **Step 2: Create the themes module with the Playful Pop palette**

Create `packages/web/src/lib/themes.ts`. Move the existing `THEMES` object and `applyTheme` here verbatim (copy the three existing entries — obsidian, light, forest — from `stores/global-settings-store.ts:5-119`), then add the `playful` entry shown below:

```ts
import type { ThemeId } from "@otterbot/shared";

export const THEMES: Record<ThemeId, { label: string; vars: Record<string, string> }> = {
  // ... obsidian, light, forest copied verbatim from the old store ...
  playful: {
    label: "Playful Pop",
    vars: {
      "--bg": "18 19 39",
      "--surface": "26 28 56",
      "--surface-elevated": "36 38 74",
      "--surface-sunken": "14 15 34",
      "--fg": "238 240 255",
      "--muted": "154 160 207",
      "--subtle": "106 111 160",
      "--border": "48 51 106",
      "--border-strong": "70 74 130",
      "--ring": "61 215 196",
      "--accent": "61 215 196",
      "--accent-fg": "10 16 36",
      "--accent-hover": "90 226 210",
      "--success": "61 215 196",
      "--success-bg": "16 46 44",
      "--warning": "255 200 97",
      "--warning-bg": "58 46 18",
      "--info": "122 162 240",
      "--info-bg": "24 32 60",
      "--danger": "255 122 102",
      "--danger-bg": "52 26 24",
      "--neutral": "120 124 170",
      "--neutral-bg": "36 38 70",
      "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.45)",
      "--shadow-md": "0 6px 18px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.55)",
      "--shadow-lg": "0 24px 70px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.45)",
    },
  },
};

export function applyTheme(theme: ThemeId): void {
  const def = THEMES[theme] ?? THEMES.playful;
  for (const [key, value] of Object.entries(def.vars)) {
    document.documentElement.style.setProperty(key, value);
  }
}
```

- [ ] **Step 3: Write the failing unit test**

Create `packages/web/src/lib/themes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { THEMES } from "./themes";

describe("THEMES", () => {
  it("includes Playful Pop with the indigo background", () => {
    expect(THEMES.playful).toBeDefined();
    expect(THEMES.playful.label).toBe("Playful Pop");
    expect(THEMES.playful.vars["--bg"]).toBe("18 19 39");
    expect(THEMES.playful.vars["--accent"]).toBe("61 215 196");
  });

  it("every theme defines the same set of variables", () => {
    const keys = Object.keys(THEMES.obsidian.vars).sort();
    for (const id of Object.keys(THEMES)) {
      expect(Object.keys(THEMES[id as keyof typeof THEMES].vars).sort()).toEqual(keys);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @otterbot/web exec vitest run src/lib/themes.test.ts`
Expected: FAIL (module `./themes` not found, or `THEMES.playful` undefined) until Step 2 is saved. (If Step 2 already saved, it should PASS — that's fine.)

- [ ] **Step 5: Re-point the store at the themes module and flip defaults**

In `packages/web/src/stores/global-settings-store.ts`:
- Delete the inline `THEMES` object and `applyTheme` function (lines ~5-119).
- Add at top: `export { THEMES, applyTheme } from "../lib/themes";`
- Change `DEFAULT_SETTINGS.theme` (line ~106) from `"obsidian"` to `"playful"`.

- [ ] **Step 6: Make first paint match (index.css)**

In `packages/web/src/index.css`, replace the `:root` color values (lines ~9-46) with the Playful Pop values from Step 2 (same variable names, the `18 19 39` / `61 215 196` / etc. triples). Leave the Motion + Type families blocks unchanged.

- [ ] **Step 7: Flip the server default theme**

In `packages/server/src/orchestrator/orchestrator.ts:238`, change `theme: "obsidian",` to `theme: "playful",`.

- [ ] **Step 8: Verify tests + build**

Run: `pnpm --filter @otterbot/web exec vitest run src/lib/themes.test.ts`
Expected: PASS (2 tests).
Run: `pnpm --filter @otterbot/web build`
Expected: build succeeds (no TS errors from the new ThemeId member).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/settings.ts packages/web/src/lib/themes.ts packages/web/src/lib/themes.test.ts packages/web/src/stores/global-settings-store.ts packages/web/src/index.css packages/server/src/orchestrator/orchestrator.ts
git commit -m "feat(web): add Playful Pop theme as the default"
```

---

## Task 2: Command / action registry

**Files:**
- Create: `packages/web/src/lib/commands.ts`
- Test: `packages/web/src/lib/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/commands.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { buildCommands, filterCommands, type CommandContext } from "./commands";

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return {
    views: [
      { id: "chat", label: "Chat" },
      { id: "settings", label: "Settings" },
    ],
    agents: [{ id: "coo", displayName: "Otto" }],
    setView: vi.fn(),
    setActive: vi.fn(),
    openSettings: vi.fn(),
    onNewAgent: vi.fn(),
    ...over,
  };
}

describe("buildCommands", () => {
  it("creates navigation, agent, and action commands", () => {
    const cmds = buildCommands(ctx());
    expect(cmds.find((c) => c.id === "nav:chat")).toBeTruthy();
    expect(cmds.find((c) => c.id === "agent:coo")?.title).toBe("Chat with Otto");
    expect(cmds.find((c) => c.id === "action:new-agent")).toBeTruthy();
    expect(cmds.find((c) => c.id === "action:settings")).toBeTruthy();
  });

  it("agent command selects the agent and opens chat", () => {
    const c = ctx();
    buildCommands(c).find((x) => x.id === "agent:coo")!.run();
    expect(c.setActive).toHaveBeenCalledWith("coo");
    expect(c.setView).toHaveBeenCalledWith("chat");
  });
});

describe("filterCommands", () => {
  const cmds = buildCommands(ctx());
  it("returns everything for an empty query", () => {
    expect(filterCommands(cmds, "")).toHaveLength(cmds.length);
  });
  it("matches on title and keywords, case-insensitively", () => {
    const r = filterCommands(cmds, "otto");
    expect(r[0]?.id).toBe("agent:coo");
  });
  it("ranks prefix matches above substring matches", () => {
    const r = filterCommands(cmds, "chat");
    // "Chat with Otto" (prefix) ranks before "Go to Chat" (substring)
    expect(r[0]?.title.startsWith("Chat")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @otterbot/web exec vitest run src/lib/commands.test.ts`
Expected: FAIL with "Cannot find module './commands'".

- [ ] **Step 3: Implement the registry**

Create `packages/web/src/lib/commands.ts`:

```ts
export type CommandGroup = "Navigation" | "Agents" | "Actions";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  keywords: string[];
  run: () => void;
}

export interface CommandContext {
  views: { id: string; label: string }[];
  agents: { id: string; displayName: string }[];
  setView: (id: string) => void;
  setActive: (id: string) => void;
  openSettings: () => void;
  onNewAgent: () => void;
}

export function buildCommands(ctx: CommandContext): Command[] {
  const nav: Command[] = ctx.views.map((v) => ({
    id: `nav:${v.id}`,
    title: `Go to ${v.label}`,
    group: "Navigation",
    keywords: [v.label, v.id],
    run: () => ctx.setView(v.id),
  }));

  const agents: Command[] = ctx.agents.map((a) => ({
    id: `agent:${a.id}`,
    title: `Chat with ${a.displayName}`,
    group: "Agents",
    keywords: [a.displayName, a.id, "chat", "dm"],
    run: () => {
      ctx.setActive(a.id);
      ctx.setView("chat");
    },
  }));

  const actions: Command[] = [
    {
      id: "action:new-agent",
      title: "Hire new agent",
      group: "Actions",
      keywords: ["new", "agent", "hire", "create"],
      run: ctx.onNewAgent,
    },
    {
      id: "action:settings",
      title: "Open settings",
      group: "Actions",
      keywords: ["settings", "preferences", "config"],
      run: ctx.openSettings,
    },
  ];

  return [...agents, ...nav, ...actions];
}

/** Substring filter with prefix-first ranking. Empty query → original order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  const scored: { cmd: Command; score: number }[] = [];
  for (const cmd of commands) {
    const hay = [cmd.title, ...cmd.keywords].map((s) => s.toLowerCase());
    const prefix = hay.some((h) => h.startsWith(q));
    const includes = hay.some((h) => h.includes(q));
    if (!includes) continue;
    scored.push({ cmd, score: prefix ? 0 : 1 });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .map((s) => s.cmd);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @otterbot/web exec vitest run src/lib/commands.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/commands.ts packages/web/src/lib/commands.test.ts
git commit -m "feat(web): add command/action registry for the palette"
```

---

## Task 3: Command palette UI + ⌘K wiring

**Files:**
- Create: `packages/web/src/components/CommandPalette.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/e2e/07-command-palette.spec.ts`

- [ ] **Step 1: Build the palette component**

Create `packages/web/src/components/CommandPalette.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands";

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-testid="command-palette"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(7, 8, 18, 0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        style={{
          width: 560,
          maxWidth: "92%",
          background: "rgb(var(--surface-elevated))",
          border: "1px solid rgb(var(--border))",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-testid="command-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to anything…"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgb(var(--border))",
            color: "rgb(var(--fg))",
            fontSize: 15,
            padding: "15px 17px",
            outline: "none",
          }}
        />
        <div style={{ maxHeight: 340, overflowY: "auto", padding: 7 }}>
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              data-testid="command-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => run(cmd)}
              style={{
                display: "flex",
                width: "100%",
                gap: 11,
                alignItems: "center",
                textAlign: "left",
                padding: "9px 10px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                color: "rgb(var(--fg))",
                background:
                  i === active
                    ? "linear-gradient(90deg, rgba(61,215,196,0.2), rgba(61,215,196,0.05))"
                    : "transparent",
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{cmd.title}</span>
              <span style={{ fontSize: 10, color: "rgb(var(--subtle))" }}>{cmd.group}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ padding: "14px 12px", color: "rgb(var(--subtle))", fontSize: 13 }}>
              No matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into App.tsx**

In `packages/web/src/App.tsx`:

Add imports near the others:

```tsx
import { useMemo } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { buildCommands } from "./lib/commands";
```

Inside `AuthedApp`, add palette state and a global ⌘K listener (place near the other `useState`/`useEffect` hooks):

```tsx
const [paletteOpen, setPaletteOpen] = useState(false);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setPaletteOpen((v) => !v);
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, []);

const commands = useMemo(
  () =>
    buildCommands({
      views: VIEWS.map((v) => ({ id: v.id, label: v.label })),
      agents: agents.map((a) => ({ id: a.id, displayName: a.displayName })),
      setView: (id) => setView(id as MainView),
      setActive,
      openSettings: () => openSettings(),
      onNewAgent: () => setCreateOpen(true),
    }),
  [agents, setActive]
);
```

Add a visible trigger button at the start of the existing `<nav>` (so the palette is reachable by click as well as ⌘K). Insert just inside `<nav>`, before `<LayoutGroup>`:

```tsx
<button
  data-testid="command-trigger"
  onClick={() => setPaletteOpen(true)}
  style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    margin: "6px 8px 6px 0",
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
```

Render the palette near the other modals (before `{showOnboarding && ...}`):

```tsx
<CommandPalette
  open={paletteOpen}
  commands={commands}
  onClose={() => setPaletteOpen(false)}
/>
```

- [ ] **Step 3: Write the e2e test**

Create `packages/web/e2e/07-command-palette.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("command palette", () => {
  test("opens, filters, and navigates to settings", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("command-trigger").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-input").fill("settings");
    await page.getByTestId("command-input").press("Enter");

    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(page.getByTestId("global-settings")).toBeVisible();
  });

  test("escape closes the palette", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("command-trigger").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-input").press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();
  });
});
```

- [ ] **Step 4: Run the e2e test**

Run: `pnpm --filter @otterbot/web test:e2e e2e/07-command-palette.spec.ts`
Expected: PASS (2 tests). The Playwright config boots its own server + fake model.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/CommandPalette.tsx packages/web/src/App.tsx packages/web/e2e/07-command-palette.spec.ts
git commit -m "feat(web): add ⌘K command palette"
```

---

## Task 4: Office floor strip

**Files:**
- Create: `packages/web/src/components/agents/OfficeFloor.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/e2e/01-shell.spec.ts`

- [ ] **Step 1: Build the OfficeFloor component**

Create `packages/web/src/components/agents/OfficeFloor.tsx`:

```tsx
import { useAgentsStore } from "../../stores/agents-store";
import type { AgentStatus } from "@otterbot/shared";

const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "rgb(var(--success))",
  thinking: "rgb(var(--warning))",
  waiting: "rgb(var(--warning))",
  idle: "rgb(var(--subtle))",
  stopped: "rgb(var(--subtle))",
  error: "rgb(var(--danger))",
};

export function OfficeFloor({ onOpenOffice }: { onOpenOffice?: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const setActive = useAgentsStore((s) => s.setActive);
  const working = agents.filter((a) => a.status === "working" || a.status === "thinking").length;

  return (
    <div
      data-testid="office-floor"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 76,
        padding: "0 16px",
        borderTop: "1px solid rgb(var(--border))",
        background: "rgb(var(--surface-sunken))",
        overflowX: "auto",
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgb(var(--subtle))", fontWeight: 700 }}>
        Office · {working} working
      </div>
      {agents.map((a) => (
        <button
          key={a.id}
          data-testid={`floor-station-${a.id}`}
          onClick={() => setActive(a.id)}
          title={`${a.displayName} · ${a.status}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "7px 11px 7px 8px",
            borderRadius: 12,
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            cursor: "pointer",
            color: "rgb(var(--fg))",
            opacity: a.status === "idle" || a.status === "stopped" ? 0.55 : 1,
            flex: "none",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 8,
              background: "rgb(var(--surface-elevated))",
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 800,
              position: "relative",
            }}
          >
            {a.displayName.slice(0, 1).toUpperCase()}
            <span
              style={{
                position: "absolute",
                right: -3,
                bottom: -3,
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: STATUS_COLOR[a.status],
                border: "2px solid rgb(var(--surface))",
              }}
            />
          </span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{a.displayName}</span>
            <span style={{ fontSize: 9, color: "rgb(var(--subtle))" }}>{a.status}</span>
          </span>
        </button>
      ))}
      {onOpenOffice && (
        <button
          onClick={onOpenOffice}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontWeight: 600,
            color: "rgb(var(--accent))",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Open office ▸
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it at the bottom of the shell**

In `packages/web/src/App.tsx`:

Add the import:

```tsx
import { OfficeFloor } from "./components/agents/OfficeFloor";
```

The right column is the `<div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>` that wraps the `<nav>` and the view container. Add `<OfficeFloor />` as the last child of that column, immediately AFTER the closing `</div>` of the `{/* view container */}` (`<div style={{ flex: 1, minHeight: 0 }}>…</div>`) and BEFORE the column's own closing `</div>`:

```tsx
        <div style={{ flex: 1, minHeight: 0 }}>
          {/* ...existing view switch... */}
        </div>
        <OfficeFloor onOpenOffice={() => setView("network")} />
      </div>
```

- [ ] **Step 3: Add the e2e assertion**

In `packages/web/e2e/01-shell.spec.ts`, add a test inside the `describe("shell", ...)` block:

```ts
  test("office floor shows the COO station", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("office-floor")).toBeVisible();
    await expect(page.getByTestId("floor-station-coo")).toBeVisible();
  });
```

- [ ] **Step 4: Run the shell e2e tests**

Run: `pnpm --filter @otterbot/web test:e2e e2e/01-shell.spec.ts`
Expected: PASS (all existing shell tests + the new office-floor test).

- [ ] **Step 5: Build to confirm types**

Run: `pnpm --filter @otterbot/web build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/agents/OfficeFloor.tsx packages/web/src/App.tsx packages/web/e2e/01-shell.spec.ts
git commit -m "feat(web): add office floor strip to the shell"
```

---

## Final verification

- [ ] Run the full web unit suite: `pnpm --filter @otterbot/web test` → PASS (themes + commands).
- [ ] Run the full e2e suite: `pnpm --filter @otterbot/web test:e2e` → PASS (existing + new specs).
- [ ] Build server + web: `pnpm --filter @otterbot/server build && pnpm --filter @otterbot/web build` → both succeed.
- [ ] Manual (`pnpm dev`): app loads in Playful Pop colors; ⌘K (and the "Jump to…" button) opens the palette; typing "Otto"/"settings"/"hire" filters; Enter navigates/runs; Escape closes; the office floor shows agent stations with status dots; Appearance settings can switch back to Obsidian/Light/Forest and the palette/floor still render.

## Not in this plan (later plans)

Sidebar IA rebuild (Leadership/Channels/Projects/DMs grouping, removing the top-tab nav), chat channel surface + inline work cards, project pod dashboard + build-run detail, settings top-tab layout, agent profile page, company org chart, PixiOffice reskin, onboarding "hire your COO" reflow, full Activity feed. Each gets its own spec-derived plan; this skeleton is the foundation they build on.
```
