import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getSocket } from "../../lib/socket";

/**
 * A live xterm.js terminal into one agent, streamed over the shared socket.
 * Reused both full-screen (inside `TerminalModal`) and inline (the Activity
 * view's live coding sessions). Two kinds:
 *  - "shell"  → an interactive shell in the agent's sandboxed workspace
 *               (`term:*` handlers).
 *  - "coding" → attaches to the agent's running coding-CLI session (`coding:*`
 *               handlers); the PTY/process is started by the `coding_cli_run` tool.
 * Pass `interactive={false}` for a read-only view (headless coding runs take no
 * stdin) — keystrokes are not forwarded.
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

export const TERMINAL_THEME = {
  background: "#0b0b0f",
  foreground: "#d4d4d8",
  cursor: "#d4d4d8",
  selectionBackground: "#3a3a45",
};

export function TerminalView({
  agentId,
  kind = "shell",
  interactive = true,
  initialCommand,
  onExited,
  style,
}: {
  agentId: string;
  kind?: TerminalKind;
  /** When false, keystrokes are not forwarded (read-only watch). */
  interactive?: boolean;
  /** A command auto-run once the shell is ready (e.g. a login command). */
  initialCommand?: string;
  /** Called when the session ends, with a human-readable reason. */
  onExited?: (reason: string) => void;
  style?: React.CSSProperties;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest onExited without re-running the effect (which would tear
  // down and re-attach the terminal).
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const socket = getSocket();
    const ev = EVENTS[kind];

    const term = new Terminal({
      cursorBlink: interactive,
      disableStdin: !interactive,
      fontFamily: '"JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    if (interactive) term.focus();

    socket.emit(ev.open, { agentId, cols: term.cols, rows: term.rows });

    const typed = interactive
      ? term.onData((data) => socket.emit(ev.input, { agentId, data }))
      : null;

    // Auto-run an initial command (e.g. a login) once the shell is ready —
    // gated on the first output so it lands after the prompt is up, sent once.
    let sentInit = false;
    const maybeSendInit = () => {
      if (sentInit || !initialCommand || !interactive) return;
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
      onExitedRef.current?.(reason);
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
      typed?.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [agentId, kind, interactive, initialCommand]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%", ...style }} />;
}
