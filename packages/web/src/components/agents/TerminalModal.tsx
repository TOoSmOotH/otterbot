import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";

/**
 * A live interactive shell into one agent's sandboxed workspace, rendered with
 * xterm.js over the shared socket. The PTY itself lives on the server (see the
 * `term:*` handlers in socket.ts) and is confined to the same sandbox as the
 * agent's `shell_exec` tool.
 */

interface TermOutput {
  agentId: string;
  data: string;
}
interface TermExit {
  agentId: string;
  exitCode?: number;
  error?: string;
}

const TERMINAL_THEME = {
  background: "#0b0b0f",
  foreground: "#d4d4d8",
  cursor: "#d4d4d8",
  selectionBackground: "#3a3a45",
};

export function TerminalModal({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [exited, setExited] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const socket = getSocket();

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    term.focus();

    socket.emit("term:open", { agentId, cols: term.cols, rows: term.rows });

    const typed = term.onData((data) => socket.emit("term:input", { agentId, data }));

    const onOutput = (p: TermOutput) => {
      if (p.agentId === agentId) term.write(p.data);
    };
    const onExit = (p: TermExit) => {
      if (p.agentId !== agentId) return;
      const reason = p.error
        ? p.error
        : `session ended${p.exitCode != null ? ` (exit ${p.exitCode})` : ""}`;
      term.write(`\r\n\x1b[90m— ${reason} —\x1b[0m\r\n`);
      setExited(reason);
    };
    socket.on("term:output", onOutput);
    socket.on("term:exit", onExit);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.emit("term:resize", { agentId, cols: term.cols, rows: term.rows });
      } catch {
        /* host detached mid-resize */
      }
    });
    ro.observe(host);

    return () => {
      socket.emit("term:close", { agentId });
      socket.off("term:output", onOutput);
      socket.off("term:exit", onExit);
      typed.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [agentId]);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={header}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            {agentName} · workspace terminal
          </span>
          <span style={{ flex: 1 }} />
          {exited && <span style={exitBadge}>{exited}</span>}
          <button style={closeBtn} onClick={onClose} aria-label="Close terminal">
            ✕
          </button>
        </div>
        <div ref={hostRef} style={termHost} />
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
  background: "#0b0b0f",
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
