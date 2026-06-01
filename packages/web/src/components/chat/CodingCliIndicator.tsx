import { useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import { apiFetch } from "../../lib/api";
import { Icon } from "../ui/Icon";

/**
 * Compact, at-a-glance login status for the coding CLIs, shown in the chat
 * header. Installs + logins are shared across all agents, so this reflects the
 * instance-wide state. One colored dot per installed tool — green = logged in,
 * amber = installed but not logged in. Hidden entirely until at least one tool
 * is installed. Click to manage in Settings → Coding CLIs.
 */

type CodingTool = "claude" | "codex" | "gemini" | "opencode";

interface ToolStatus {
  installed: boolean;
  loggedIn: boolean;
}

const LABELS: Record<CodingTool, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};
const ORDER: CodingTool[] = ["claude", "codex", "gemini", "opencode"];

export function CodingCliIndicator({ onOpenSettings }: { onOpenSettings?: (tab?: string) => void }) {
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

  const installed = status ? ORDER.filter((t) => status[t]?.installed) : [];
  if (installed.length === 0) return null;

  const allLoggedIn = installed.every((t) => status![t].loggedIn);
  const summary = `Coding CLIs — ${installed
    .map((t) => `${LABELS[t]}: ${status![t].loggedIn ? "logged in" : "not logged in"}`)
    .join(", ")}. Click to manage.`;

  return (
    <button
      type="button"
      title={summary}
      aria-label={summary}
      onClick={() => onOpenSettings?.("Coding CLIs")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid rgb(var(--border))",
        background: "transparent",
        cursor: "pointer",
        color: "rgb(var(--muted))",
      }}
    >
      <Icon icon={Terminal} size={13} />
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {installed.map((t) => (
          <span
            key={t}
            title={`${LABELS[t]}: ${status![t].loggedIn ? "logged in" : "not logged in"}`}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: status![t].loggedIn ? "#4ade80" : "#fbbf24",
            }}
          />
        ))}
      </span>
      {!allLoggedIn && (
        <span style={{ fontSize: 10, color: "#fbbf24", whiteSpace: "nowrap" }}>login needed</span>
      )}
    </button>
  );
}
