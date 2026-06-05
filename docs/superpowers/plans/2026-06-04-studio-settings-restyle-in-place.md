# The Studio — Settings Restyle In Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bring the REAL settings content into the Playful Pop look by upgrading the shared style primitives that every settings tab and the provider/model wizards already use — no invented structure, no content changes. Rounder corners, theme-correct button text, token-based card surfaces.

**Architecture:** All six settings tabs (`ModelsProvidersTab`, `CodingCliSetup`, `CodingModelsTab`, `IntegrationsTab`, `AppearanceTab`, `AccountTab`) and the wizards (`ProviderWizard`, `ModelWizard`) import their buttons/inputs/cards/panels from `packages/web/src/components/settings/settings-styles.tsx`. Restyling those exported `CSSProperties` objects propagates everywhere uniformly. This is a pure style change — no markup, behavior, or testid changes. Fixes a real bug: `primary` uses `color: "white"` (wrong on the light theme) → `rgb(var(--accent-fg))`.

**Tech Stack:** React `CSSProperties` objects, `rgb(var(--token))`. Playwright e2e as the regression gate.

**Out of scope:** the multi-step Integrations wizard's internal layout, per-tab markup, and any structural change. Only the shared primitives.

---

## File Structure

- `packages/web/src/components/settings/settings-styles.tsx` — restyle the exported style objects.

---

## Task 1: Modernize the shared settings primitives

**Files:**
- Modify: `packages/web/src/components/settings/settings-styles.tsx`

- [ ] **Step 1: Apply the restyle**

Replace the style objects in `settings-styles.tsx` with these values (keep the `section`, `hint`, and `Field` helper as they are unless noted; do not change exported names or signatures):

```tsx
export const h2: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700 };

export const panel: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: "rgb(var(--surface))",
};

export const accountCard: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "rgb(var(--surface))",
};

export const input: CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: "8px 10px",
  fontSize: 13,
  minWidth: 0,
  width: "100%",
};

export const primary: CSSProperties = {
  background: "rgb(var(--accent))",
  color: "rgb(var(--accent-fg))",
  border: "none",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
  boxShadow: "var(--shadow-sm)",
};

export const ghostButton: CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

export const badge: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 999,
  padding: "2px 8px",
  fontSize: 11,
  color: "rgb(var(--muted))",
  background: "rgb(var(--surface-elevated))",
};

export const starButton: CSSProperties = {
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: "3px 6px",
  cursor: "pointer",
  fontSize: 11,
};
```

Leave `section`, `hint`, and `Field` unchanged. Do not rename or remove any export (consumers across the settings tabs + wizards depend on them).

- [ ] **Step 2: Build**

Run: `pnpm --filter @otterbot/web build`
Expected: success, no TS errors (these are `CSSProperties` literals; `boxShadow: "var(--shadow-sm)"` is a valid string value).

- [ ] **Step 3: Regression e2e (no behavior changed, so these must still pass)**

Run: `pnpm --filter @otterbot/web test:e2e e2e/08-studio-shell.spec.ts e2e/09-settings.spec.ts`
Expected: all pass (gear → settings, tab switch, theme button). If `03-agents.spec.ts` exercises settings, run it too and report.

- [ ] **Step 4: Commit** (no Co-Authored-By trailer)

```bash
git add packages/web/src/components/settings/settings-styles.tsx
git commit -m "feat(web): Playful Pop restyle of shared settings primitives"
```

---

## Final verification

- [ ] `pnpm --filter @otterbot/web build` → success.
- [ ] `pnpm --filter @otterbot/web test:e2e e2e/08-studio-shell.spec.ts e2e/09-settings.spec.ts` → pass.
- [ ] Manual (`pnpm dev` → Settings): buttons, inputs, account/provider/model cards, and panels across every tab now read as Playful Pop (rounder corners, surface-colored cards, accent buttons with correct on-accent text); primary buttons are legible on the light theme too (no white-on-accent bug).

## Not in this plan (later, if wanted)

The signature teal→coral gradient on primary buttons (needs a new `--accent-2` token added across all four themes); restyling the Integrations multi-step wizard layout; per-tab markup polish.
