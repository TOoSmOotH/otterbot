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

export const h2: CSSProperties = { margin: 0, fontSize: 14 };
export const hint: CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "rgb(var(--muted))" };

export const panel: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const accountCard: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "rgba(255,255,255,0.02)",
};

export const input: CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  minWidth: 0,
  width: "100%",
};

export const primary: CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  borderRadius: 7,
  padding: "8px 13px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

export const ghostButton: CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 13,
};

export const badge: CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: 11,
  color: "rgb(var(--muted))",
};

export const starButton: CSSProperties = {
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "3px 5px",
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
