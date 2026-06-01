import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";

/**
 * A live terminal into one agent, rendered with xterm.js over the shared
 * socket. Two kinds:
 *  - "shell"  → an interactive shell in the agent's sandboxed workspace
 *               (`term:*` handlers).
 *  - "coding" → attaches to the agent's running coding-CLI session (`coding:*`
 *               handlers); the PTY is started by the `coding_cli_run` tool.
 * Both PTYs live on the server, confined to the same sandbox as `shell_exec`.
 */

export type TerminalKind = "shell" | "coding";

/** Socket event names per kind. */
const EVENTS: Record<
  TerminalKind,
  { open: string; input: string; resize: string; close: string; output: string; exit: string }
> = {
  shell: {
    open: "term:open",
    input: "term:input",
    resize: "term:resize",
    close: "term:close",
    output: "term:output",
    exit: "term:exit",
  },
  coding: {
    // The session is started server-side by the tool; we attach to it.
    open: "coding:attach",
    input: "coding:input",
    resize: "coding:resize",
    close: "coding:detach",
    output: "coding:output",
    exit: "coding:exit",
  },
};

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [exited, setExited] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const socket = getSocket();
    const ev = EVENTS[kind];

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

    socket.emit(ev.open, { agentId, cols: term.cols, rows: term.rows });

    const typed = term.onData((data) => socket.emit(ev.input, { agentId, data }));

    // Auto-run an initial command (e.g. a login) once the shell is ready —
    // gated on the first output so it lands after the prompt is up, sent once.
    let sentInit = false;
    const maybeSendInit = () => {
      if (sentInit || !initialCommand) return;
      sentInit = true;
      setTimeout(() => socket.emit(ev.input, { agentId, data: `${initialCommand}\r` }), 300);
    };

    const onOutput = (p: TermOutput) => {
      if (p.agentId !== agentId) return;
      term.write(p.data);
      maybeSendInit();
    };
    const onExit = (p: TermExit) => {
      if (p.agentId !== agentId) return;
      const reason = p.error
        ? p.error
        : `session ended${p.exitCode != null ? ` (exit ${p.exitCode})` : ""}`;
      term.write(`\r\n\x1b[90m— ${reason} —\x1b[0m\r\n`);
      setExited(reason);
    };
    socket.on(ev.output, onOutput);
    socket.on(ev.exit, onExit);

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        socket.emit(ev.resize, { agentId, cols: term.cols, rows: term.rows });
      } catch {
        /* host detached mid-resize */
      }
    });
    ro.observe(host);

    return () => {
      socket.emit(ev.close, { agentId });
      socket.off(ev.output, onOutput);
      socket.off(ev.exit, onExit);
      typed.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [agentId, kind]);

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
