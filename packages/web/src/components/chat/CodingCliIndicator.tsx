import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { Icon } from "../ui/Icon";
import { CODING_TOOLS, CODING_TOOL_LABELS, type CodingTool } from "../../lib/coding-cli";

/**
 * Compact, at-a-glance login status for the coding CLIs, shown in the chat
 * header. Installs + logins are shared across all agents, so this reflects the
 * instance-wide state. One dot per installed tool — green = logged in, amber =
 * installed but not logged in. An amber dot (and the "log in" hint) is clickable
 * and opens a shell with that tool's login command already running. The leading
 * icon opens Settings → Coding CLIs. Hidden until at least one tool is installed.
 */

interface ToolStatus {
  installed: boolean;
  loggedIn: boolean;
}

export function CodingCliIndicator({
  onOpenSettings,
  onOpenLoginTerminal,
}: {
  onOpenSettings?: (tab?: string) => void;
  onOpenLoginTerminal?: (tool: CodingTool) => void;
}) {
  const [status, setStatus] = useState<Record<CodingTool, ToolStatus> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch("/api/coding-cli/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!cancelled && s) setStatus(s as Record<CodingTool, ToolStatus>);
        })
        .catch(() => {});
    void load();
    // Logins happen in a terminal mid-session — refresh when the tab regains focus.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const installed = status ? CODING_TOOLS.filter((t) => status[t]?.installed) : [];
  if (installed.length === 0) return null;

  const needLogin = installed.filter((t) => !status![t].loggedIn);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid rgb(var(--border))",
        color: "rgb(var(--muted))",
      }}
    >
      <button
        type="button"
        title="Manage coding CLIs (Settings → Coding CLIs)"
        aria-label="Manage coding CLIs"
        onClick={() => onOpenSettings?.("Coding CLIs")}
        style={iconBtn}
      >
        <Icon icon={Terminal} size={13} />
      </button>
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {installed.map((t) =>
          status![t].loggedIn ? (
            <span key={t} title={`${CODING_TOOL_LABELS[t]}: logged in`} style={dot("#4ade80")} />
          ) : (
            <button
              key={t}
              type="button"
              title={`${CODING_TOOL_LABELS[t]}: not logged in — click to open a login shell`}
              aria-label={`Log in to ${CODING_TOOL_LABELS[t]}`}
              onClick={() => onOpenLoginTerminal?.(t)}
              style={{ ...iconBtn, ...dot("#fbbf24"), padding: 0 }}
            />
          )
        )}
      </span>
      {needLogin.length > 0 && (
        <button
          type="button"
          onClick={() => onOpenLoginTerminal?.(needLogin[0])}
          title={`Open a shell to log in to ${CODING_TOOL_LABELS[needLogin[0]]}`}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            fontSize: 10,
            color: "#fbbf24",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          log in
        </button>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "inherit",
  display: "inline-flex",
  alignItems: "center",
};

const dot = (color: string): React.CSSProperties => ({
  width: 9,
  height: 9,
  borderRadius: "50%",
  background: color,
  display: "inline-block",
});
