import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";

/**
 * Install + status panel for the coding CLIs, shown inside the `coding-cli`
 * capability. Lists each tool with install / login badges, installs missing
 * ones into the agent's workspace (one at a time), and surfaces the interactive
 * login command for tools that aren't logged in yet. Login itself stays manual
 * — run the shown command from the agent's terminal.
 */

type CodingTool = "claude" | "codex" | "gemini" | "opencode";

interface ToolStatus {
  installed: boolean;
  version?: string;
  loggedIn: boolean;
}

type StatusMap = Record<CodingTool, ToolStatus>;

const TOOLS: { tool: CodingTool; label: string; loginCmd: string }[] = [
  { tool: "claude", label: "Claude Code", loginCmd: "claude" },
  { tool: "codex", label: "Codex", loginCmd: "codex login" },
  { tool: "gemini", label: "Gemini CLI", loginCmd: "gemini" },
  { tool: "opencode", label: "OpenCode", loginCmd: "opencode auth login" },
];

export function CodingCliSetup({ agentId }: { agentId: string }) {
  const [status, setStatus] = useState<StatusMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<CodingTool | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    const res = await apiFetch(`/api/agents/${agentId}/coding-cli/status`);
    if (res.ok) setStatus((await res.json()) as StatusMap);
    setLoading(false);
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const install = async (tool: CodingTool) => {
    setInstalling(tool);
    setError(null);
    const res = await apiFetch(`/api/agents/${agentId}/coding-cli/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool }),
    });
    const data = await res.json().catch(() => null);
    setInstalling(null);
    if (res.ok && data?.status) {
      setStatus(data.status as StatusMap);
      if (!data.ok) setError(data.error ?? `Failed to install ${tool}.`);
    } else {
      setError(data?.error ?? `Failed to install ${tool}.`);
    }
  };

  if (loading) return <div style={hint}>Checking installed tools…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <p style={hint}>
        Install a tool to put its binary on this agent's PATH, then log it in once from
        the agent's <strong>Terminal</strong> (the login flows are interactive). Both
        steps are per-agent and persist in this agent's workspace.
      </p>
      {TOOLS.map(({ tool, label, loginCmd }) => {
        const s = status?.[tool] ?? { installed: false, loggedIn: false };
        return (
          <div key={tool} style={row}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 13 }}>{label}</strong>
                <span style={s.installed ? okBadge : offBadge}>
                  {s.installed ? "Installed" : "Not installed"}
                </span>
                {s.installed && (
                  <span style={s.loggedIn ? okBadge : warnBadge}>
                    {s.loggedIn ? "Logged in" : "Not logged in"}
                  </span>
                )}
                {s.version && <span style={hint}>{s.version}</span>}
              </div>
              {s.installed && !s.loggedIn && (
                <span style={hint}>
                  Log in from the Terminal: <code style={code}>{loginCmd}</code>
                </span>
              )}
            </div>
            {!s.installed && (
              <button
                type="button"
                onClick={() => void install(tool)}
                disabled={installing !== null}
                style={{ ...primary, opacity: installing !== null ? 0.6 : 1 }}
              >
                {installing === tool ? "Installing…" : "Install"}
              </button>
            )}
          </div>
        );
      })}
      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: "8px 10px",
};

const badge: React.CSSProperties = {
  fontSize: 11,
  borderRadius: 5,
  padding: "1px 7px",
  border: "1px solid rgb(var(--border))",
  whiteSpace: "nowrap",
};

const okBadge: React.CSSProperties = { ...badge, color: "#4ade80", borderColor: "#4ade80" };
const warnBadge: React.CSSProperties = { ...badge, color: "#fbbf24", borderColor: "#fbbf24" };
const offBadge: React.CSSProperties = { ...badge, color: "rgb(var(--muted))" };

const code: React.CSSProperties = {
  fontFamily: "monospace",
  background: "rgb(var(--bg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "1px 5px",
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "6px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "rgb(var(--muted))",
  margin: 0,
  lineHeight: 1.5,
};
