import { useEffect, type CSSProperties, type ReactNode } from "react";

/**
 * A centered modal over a dimmed backdrop. Clicking the backdrop or pressing
 * Escape closes it; clicks inside the card don't bubble out. The modal owns the
 * single backdrop so wizards rendered inside it stay flat (no nested overlays).
 */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = 620,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={{ ...modal, width: `min(92vw, ${maxWidth}px)` }} onClick={(e) => e.stopPropagation()}>
        {title && (
          <div style={titleRow}>
            <strong style={{ fontSize: 14 }}>{title}</strong>
            <button onClick={onClose} aria-label="Close" style={closeBtn}>
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modal: CSSProperties = {
  maxHeight: "86vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};

const titleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};

const closeBtn: CSSProperties = {
  background: "transparent",
  color: "rgb(var(--muted))",
  border: "none",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
};
