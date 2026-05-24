import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Check, Copy, Download, Maximize2, Pencil, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { withToken } from "../../lib/api";
import { Icon } from "../ui/Icon";
import { fonts } from "../../lib/typography";

/**
 * A chat image with a hover overlay: download, edit-by-prompting, open
 * full-size, and copy-link. `onEdit` receives the user's change description;
 * the parent composes and sends the actual edit message to the agent.
 */
export function ChatImage({
  url,
  alt,
  onEdit,
}: {
  url: string;
  alt: string;
  onEdit: (change: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [editing, setEditing] = useState(false);
  const [change, setChange] = useState("");
  const [lightbox, setLightbox] = useState(false);
  const [copied, setCopied] = useState(false);

  const src = withToken(url);

  // Esc closes the lightbox or the edit popover.
  useEffect(() => {
    if (!lightbox && !editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightbox(false);
        setEditing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, editing]);

  const copyLink = async () => {
    const abs = src.startsWith("http") ? src : window.location.origin + src;
    try {
      await navigator.clipboard.writeText(abs);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const applyEdit = () => {
    const text = change.trim();
    if (!text) return;
    onEdit(text);
    setChange("");
    setEditing(false);
  };

  const toolbarVisible = hover || editing;

  return (
    <div
      style={{ position: "relative", alignSelf: "flex-start", maxWidth: "min(420px, 100%)" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img
        src={src}
        alt={alt}
        onClick={() => setLightbox(true)}
        style={{
          display: "block",
          width: "100%",
          borderRadius: 6,
          border: "1px solid rgb(var(--border))",
          cursor: "zoom-in",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          display: "flex",
          gap: 2,
          padding: 3,
          borderRadius: 6,
          background: "rgba(0,0,0,0.55)",
          opacity: toolbarVisible ? 1 : 0,
          pointerEvents: toolbarVisible ? "auto" : "none",
          transition: "opacity 0.12s ease",
        }}
      >
        <OverlayButton title="Edit" icon={Pencil} onClick={() => setEditing((v) => !v)} />
        <OverlayButton
          title={copied ? "Copied" : "Copy link"}
          icon={copied ? Check : Copy}
          onClick={copyLink}
        />
        <OverlayButton title="Full size" icon={Maximize2} onClick={() => setLightbox(true)} />
        <a
          href={src}
          download
          title="Download"
          onClick={(e) => e.stopPropagation()}
          style={overlayBtnStyle}
        >
          <Icon icon={Download} size={14} />
        </a>
      </div>

      {editing && (
        <div
          style={{
            position: "absolute",
            top: 38,
            right: 6,
            zIndex: 5,
            width: 240,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 8,
            borderRadius: 8,
            background: "rgb(var(--surface))",
            border: "1px solid rgb(var(--border))",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <textarea
            autoFocus
            value={change}
            onChange={(e) => setChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                applyEdit();
              }
            }}
            placeholder="Describe the change…"
            rows={2}
            style={{
              resize: "none",
              fontFamily: fonts.sans,
              fontSize: 12,
              lineHeight: 1.45,
              padding: 6,
              borderRadius: 6,
              border: "1px solid rgb(var(--border))",
              background: "rgb(var(--surface-sunken))",
              color: "rgb(var(--fg))",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button onClick={() => setEditing(false)} style={ghostBtnStyle}>
              Cancel
            </button>
            <button onClick={applyEdit} disabled={!change.trim()} style={applyBtnStyle(!change.trim())}>
              Apply
            </button>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, cursor: "default" }}
          />
          <button title="Close" onClick={() => setLightbox(false)} style={closeBtnStyle}>
            <Icon icon={X} size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

const overlayBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: 4,
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
};

function OverlayButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={overlayBtnStyle}
    >
      <Icon icon={icon} size={14} />
    </button>
  );
}

const ghostBtnStyle: CSSProperties = {
  fontSize: 12,
  padding: "4px 8px",
  borderRadius: 5,
  border: "1px solid rgb(var(--border))",
  background: "transparent",
  color: "rgb(var(--muted))",
  cursor: "pointer",
};

function applyBtnStyle(disabled: boolean): CSSProperties {
  return {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 5,
    border: "none",
    background: disabled ? "rgb(var(--surface-elevated))" : "rgb(var(--accent))",
    color: disabled ? "rgb(var(--subtle))" : "rgb(var(--accent-fg))",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const closeBtnStyle: CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 34,
  height: 34,
  borderRadius: 8,
  border: "none",
  background: "rgba(0,0,0,0.5)",
  color: "#fff",
  cursor: "pointer",
};
