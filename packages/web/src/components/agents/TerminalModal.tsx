import { useState } from "react";
import { TerminalView, type TerminalKind } from "./TerminalView";

/**
 * A live terminal into one agent in a full-screen modal, rendered with the
 * shared `TerminalView`. Two kinds:
 *  - "shell"  → an interactive shell in the agent's sandboxed workspace.
 *  - "coding" → attaches to the agent's running coding-CLI session (started by
 *               the `coding_cli_run` tool).
 * Both PTYs live on the server, confined to the same sandbox as `shell_exec`.
 */

export type { TerminalKind };

export function TerminalModal({
  agentId,
  agentName,
  onClose,
  kind = "shell",
  toolLabel,
  initialCommand,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
  kind?: TerminalKind;
  /** For coding sessions, the tool name shown in the header (e.g. "claude"). */
  toolLabel?: string;
  /** A command auto-run once the shell is ready (e.g. a login command). */
  initialCommand?: string;
}) {
  const [exited, setExited] = useState<string | null>(null);

  return (
    // Intentionally NOT dismissible by clicking the backdrop: a stray click
    // (e.g. while selecting/copying a login URL) would otherwise tear down the
    // PTY and kill an in-progress login. Closing is explicit via the ✕ button.
    <div style={overlay}>
      <div style={modal}>
        <div style={header}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {kind === "coding"
              ? `${agentName} · ${toolLabel ?? "coding"} session`
              : `${agentName} · workspace terminal`}
          </span>
          <span style={{ flex: 1 }} />
          {exited && <span style={exitBadge}>{exited}</span>}
          <button style={closeBtn} onClick={onClose} aria-label="Close terminal">
            ✕ Close
          </button>
        </div>
        <div style={termHost}>
          <TerminalView
            agentId={agentId}
            kind={kind}
            initialCommand={initialCommand}
            onExited={setExited}
          />
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};

const modal: React.CSSProperties = {
  width: "82vw",
  height: "72vh",
  maxWidth: 1100,
  display: "flex",
  flexDirection: "column",
  background: "rgb(var(--surface-sunken))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  overflow: "hidden",
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  borderBottom: "1px solid rgb(var(--border))",
  color: "rgb(var(--fg))",
};

const termHost: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  padding: 8,
};

const exitBadge: React.CSSProperties = {
  fontSize: 10,
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "1px 6px",
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "2px 9px",
  cursor: "pointer",
  fontSize: 12,
};
