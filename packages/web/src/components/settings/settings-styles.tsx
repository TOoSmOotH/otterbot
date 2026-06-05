import type { CSSProperties } from "react";

/**
 * Shared styles + the `Field` helper used across the settings tabs and the
 * provider/model wizards. Extracted from GlobalSettings.tsx so the wizard
 * files (which live in their own modules) can reuse the same look.
 */

export const section: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const h2: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700 };
export const hint: CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "rgb(var(--muted))" };

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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}
