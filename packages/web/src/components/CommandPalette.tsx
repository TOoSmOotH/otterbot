import { useEffect, useMemo, useRef, useState } from "react";
import { filterCommands, type Command } from "../lib/commands";

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      data-testid="command-palette"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(7, 8, 18, 0.55)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "12vh",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal={true}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: "92%",
          background: "rgb(var(--surface-elevated))",
          border: "1px solid rgb(var(--border))",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-testid="command-input"
          aria-label="Search commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Jump to anything…"
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid rgb(var(--border))",
            color: "rgb(var(--fg))",
            fontSize: 15,
            padding: "15px 17px",
            outline: "none",
          }}
        />
        <div style={{ maxHeight: 340, overflowY: "auto", padding: 7 }}>
          {results.map((cmd, i) => (
            <button
              key={cmd.id}
              data-testid="command-item"
              onMouseEnter={() => setActive(i)}
              onClick={() => run(cmd)}
              style={{
                display: "flex",
                width: "100%",
                gap: 11,
                alignItems: "center",
                textAlign: "left",
                padding: "9px 10px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                color: "rgb(var(--fg))",
                background:
                  i === active
                    ? "linear-gradient(90deg, rgba(61,215,196,0.2), rgba(61,215,196,0.05))"
                    : "transparent",
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{cmd.title}</span>
              <span style={{ fontSize: 10, color: "rgb(var(--subtle))" }}>{cmd.group}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div style={{ padding: "14px 12px", color: "rgb(var(--subtle))", fontSize: 13 }}>
              No matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
