# The Studio — Settings Top-Tabs Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the Settings page tab bar into the Studio / Playful Pop language: replace the solid-accent *pill* tabs with **underline-style tabs** (theme-tokenized) matching the mock (`settings-layouts.html` V2) and the rest of the app's tabs, and tokenize the page's hardcoded status colors.

**Architecture:** `GlobalSettings` is ALREADY a full-page top-tab layout (header → `tabBar` → `tabBody` → autosave bar). No structural change. This is a contained restyle of the tab bar + a few hardcoded colors. All tabs, the `settings-tab-<name>` testids, the autosave logic, and the per-tab content components stay exactly as-is.

**Tech Stack:** React + inline styles with `rgb(var(--token))` (established pattern). Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-04-studio-ui-redesign-design.md` (Settings = V2 full-page top tabs). Visual ref: `.superpowers/brainstorm/1757336-1780612573/content/settings-layouts.html` (V2).

**Preserve testids:** `global-settings`, `settings-tab-Models & Providers`, `settings-tab-Coding CLIs`, `settings-tab-Coding Models`, `settings-tab-Integrations`, `settings-tab-Appearance`, `settings-tab-Account`, `theme-<id>`.

---

## File Structure

- `packages/web/src/components/settings/GlobalSettings.tsx` — restyle the `tabBar` / `tabButton` styles and the active-tab rendering into underline tabs; tokenize the "update available" dot and the hardcoded `#f87171` / `#4ade80` status colors in this file.
- `packages/web/e2e/09-settings.spec.ts` — **new**: open settings via the gear, switch to a tab, assert content.

---

## Task 1: Underline-style settings tabs + tokenized colors

**Files:**
- Modify: `packages/web/src/components/settings/GlobalSettings.tsx`
- Test: `packages/web/e2e/09-settings.spec.ts`

- [ ] **Step 1: Replace the tab-bar styles**

In `GlobalSettings.tsx`, replace the `tabBar` and `tabButton` style objects (near the bottom of the file) with an underline-tab treatment:

```tsx
const tabBar: React.CSSProperties = {
  display: "flex",
  gap: 2,
  padding: "0 18px",
  borderBottom: "1px solid rgb(var(--border))",
  flexWrap: "wrap",
};

const tabButton: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: "11px 13px",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
```

- [ ] **Step 2: Update the active-tab rendering**

In the `TABS.map(...)` render, replace the inline style override that currently sets a solid accent background + `"white"` text with the underline treatment (active = foreground text + teal bottom border; inactive = muted text):

```tsx
<button
  key={t}
  data-testid={`settings-tab-${t}`}
  onClick={() => setTab(t)}
  style={{
    ...tabButton,
    color: tab === t ? "rgb(var(--fg))" : "rgb(var(--muted))",
    borderBottomColor: tab === t ? "rgb(var(--accent))" : "transparent",
  }}
>
  {t}
  {t === "Coding CLIs" && codingUpdate && (
    <span
      title="A coding CLI has an update available"
      style={{
        marginLeft: 6,
        width: 7,
        height: 7,
        borderRadius: 999,
        background: "rgb(var(--accent))",
        display: "inline-block",
      }}
    />
  )}
</button>
```

(Keep the `data-testid`, the `onClick`, and the Coding-CLIs update dot. Only the visual treatment changes; the dot color is now always the accent token instead of switching to white on the active pill.)

- [ ] **Step 3: Tokenize the remaining hardcoded status colors in this file**

Replace hardcoded hex status colors in `GlobalSettings.tsx` with tokens (these appear in the save bar, AccountTab/SessionRow, and ChangePasswordCard):
- `"#f87171"` → `"rgb(var(--danger))"` (every occurrence in this file)
- `"#4ade80"` → `"rgb(var(--success))"` (every occurrence in this file)

Use find/replace within this file only. Do not touch other files.

- [ ] **Step 4: Verify the build**

Run: `pnpm --filter @otterbot/web build`
Expected: success, no TS errors.

- [ ] **Step 5: Write the e2e test**

Create `packages/web/e2e/09-settings.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("settings", () => {
  test("opens from the gear and switches tabs", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("sidebar-gear").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();

    // Default tab is Models & Providers; switch to Appearance and see a theme button.
    await page.getByTestId("settings-tab-Appearance").click();
    await expect(page.getByTestId("theme-playful")).toBeVisible();
  });
});
```

- [ ] **Step 6: Run the e2e**

Run: `pnpm --filter @otterbot/web test:e2e e2e/09-settings.spec.ts`
Expected: 1 pass. (Playwright boots its own web server.)

- [ ] **Step 7: Commit** (no Co-Authored-By trailer)

```bash
git add packages/web/src/components/settings/GlobalSettings.tsx packages/web/e2e/09-settings.spec.ts
git commit -m "feat(web): underline-style settings tabs + tokenized status colors"
```

---

## Final verification

- [ ] `pnpm --filter @otterbot/web build` → success.
- [ ] `pnpm --filter @otterbot/web test:e2e e2e/08-studio-shell.spec.ts e2e/09-settings.spec.ts` → pass (the gear → settings flow and the new tab-switch test).
- [ ] Manual (`pnpm dev`): open Settings from the sidebar gear → the tab bar reads as underline tabs (active tab has a teal underline + brighter text), not solid pills; switching tabs works; the Coding CLIs update dot still shows when relevant; Appearance still lists all themes including Playful Pop.

## Not in this plan (later)

Restyling the Integrations tab *content* into the account-cards + bindings mock; Appearance theme-card previews; the Models/Coding tab internals. This plan only aligns the settings shell/tab-bar to the Studio language.
