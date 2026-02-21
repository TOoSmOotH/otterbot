import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { getSocket } from "../../lib/socket";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  agentId: string;
}

export function TerminalView({ agentId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#c9d1d9",
        brightBlack: "#484f58",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Initial fit
    try { fitAddon.fit(); } catch { /* container not ready */ }

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const socket = getSocket();

    // Handle incoming terminal data
    const handleData = (data: { agentId: string; data: string }) => {
      if (data.agentId === agentId) {
        term.write(data.data);
      }
    };

    // Handle replay buffer for late-joining
    const handleReplay = (data: { agentId: string; data: string }) => {
      if (data.agentId === agentId) {
        term.write(data.data);
      }
    };

    socket.on("terminal:data", handleData);
    socket.on("terminal:replay", handleReplay);

    // Subscribe to get replay buffer
    socket.emit("terminal:subscribe", { agentId });

    // Forward user input to server
    const inputDisposable = term.onData((data) => {
      socket.emit("terminal:input", { agentId, data });
    });

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        socket.emit("terminal:resize", {
          agentId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // Ignore resize errors during teardown
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      socket.off("terminal:data", handleData);
      socket.off("terminal:replay", handleReplay);
      inputDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [agentId]);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0"
      style={{ padding: "4px" }}
    />
  );
}
