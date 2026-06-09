import { useEffect, useState } from "react";
import { User, Users, Server, ArrowLeft } from "lucide-react";
import { Icon } from "../ui/Icon";
import { ModelSelect } from "./ModelSelect";
import { AgentEditor } from "./AgentEditor";
import { apiFetch } from "../../lib/api";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { useAgentsStore } from "../../stores/agents-store";
import { useProjectsStore } from "../../stores/projects-store";

/**
 * Guided agent creation. Explains the team model and lets you create one of:
 *  - a single standalone agent (the classic editor),
 *  - a coding-project team (PM + coder/security/test-writer/tester), where each
 *    role's chat model and coding CLI are customizable, or
 *  - a shared infrastructure service agent (Proxmox / SSH) used by testers.
 */

type Choice = "menu" | "single" | "team" | "service";

const CODING_TOOLS = ["claude", "codex", "antigravity", "opencode"] as const;
type Tool = (typeof CODING_TOOLS)[number];
/** A coding role's tool: a CLI, or "model" for "model only" (no coding CLI). */
type ToolChoice = Tool | "model";

interface RoleSpec {
  role: string;
  label: string;
  /** Default coding CLI; undefined for non-coding roles (pm, tester). */
  defaultTool?: Tool;
  blurb: string;
  /** Skippable in the wizard (pm + coder are mandatory). */
  optional?: boolean;
}

const ROLES: RoleSpec[] = [
  { role: "pm", label: "Project Manager", blurb: "Plans with you and runs the pipeline." },
  { role: "coder", label: "Coder", defaultTool: "claude", blurb: "Implements the feature." },
  { role: "security-reviewer", label: "Security Reviewer", defaultTool: "antigravity", blurb: "Audits the code.", optional: true },
  { role: "test-writer", label: "Test Writer", defaultTool: "opencode", blurb: "Writes the tests.", optional: true },
  { role: "tester", label: "Tester", blurb: "Runs local tests; remote e2e is optional.", optional: true },
];

export function AgentWizard({
  onClose,
  initialChoice = "menu",
}: {
  onClose: () => void;
  /** Open straight to a step (e.g. "team" from the Projects tab). */
  initialChoice?: Choice;
}) {
  const [choice, setChoice] = useState<Choice>(initialChoice);

  if (choice === "single") return <AgentEditor agentId={null} onClose={onClose} />;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {choice !== "menu" && (
          <button style={backBtn} onClick={() => setChoice("menu")}>
            <Icon icon={ArrowLeft} size={14} /> Back
          </button>
        )}
        {choice === "menu" && <Menu onPick={setChoice} />}
        {choice === "team" && <TeamForm onClose={onClose} />}
        {choice === "service" && <ServiceForm onClose={onClose} />}
      </div>
    </div>
  );
}

function Menu({ onPick }: { onPick: (c: Choice) => void }) {
  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Add to your team</h2>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, marginTop: 0 }}>
        Otterbot can run a whole <strong>coding team</strong>: a project manager plans the work and
        hands it to specialists — a coder, a security reviewer, a test writer, and a tester — who
        share one code tree. Testers run end-to-end tests by delegating to shared{" "}
        <strong>infrastructure agents</strong> (Proxmox to spin up a VM, SSH to install + run). Pick
        what to create:
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 12 }}>
        <Card icon={User} title="Single agent" desc="One standalone agent — assistant, specialist, anything." onClick={() => onPick("single")} />
        <Card icon={Users} title="Coding project team" desc="A project plus its PM/coder/security/test-writer/tester. Customize each role's model and CLI." onClick={() => onPick("team")} />
        <Card icon={Server} title="Infrastructure agent" desc="A shared Proxmox or SSH agent that project testers delegate to. Add these to enable e2e testing." onClick={() => onPick("service")} />
      </div>
    </div>
  );
}

function Card({ icon, title, desc, onClick }: { icon: typeof User; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={card}>
      <Icon icon={icon} size={18} />
      <div style={{ textAlign: "left" }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div style={{ color: "rgb(var(--muted))", fontSize: 12 }}>{desc}</div>
      </div>
    </button>
  );
}

function TeamForm({ onClose }: { onClose: () => void }) {
  const settings = useGlobalSettingsStore((s) => s.settings);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const reloadAgents = useAgentsStore((s) => s.load);
  const reloadProjects = useProjectsStore((s) => s.load);

  const [name, setName] = useState("");
  const [rules, setRules] = useState("");
  const [remoteE2e, setRemoteE2e] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<
    Record<
      string,
      { enabled: boolean; modelId: string; tool?: ToolChoice; displayName: string; persona: string; appendPersona: boolean }
    >
  >(() =>
    Object.fromEntries(
      ROLES.map((r) => [
        r.role,
        { enabled: true, modelId: "", tool: r.defaultTool, displayName: "", persona: "", appendPersona: true },
      ])
    )
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const team: Record<
      string,
      { enabled: boolean; modelId?: string; tool?: string; displayName?: string; persona?: string; appendPersona?: boolean }
    > = {};
    for (const r of ROLES) {
      const cfg = roles[r.role];
      team[r.role] = {
        // pm + coder are always enabled; optional roles follow their checkbox.
        enabled: r.optional ? cfg.enabled : true,
        ...(cfg.modelId ? { modelId: cfg.modelId } : {}),
        // "model" → "none" tells the server to skip the coding CLI for this role.
        ...(cfg.tool ? { tool: cfg.tool === "model" ? "none" : cfg.tool } : {}),
        ...(cfg.displayName.trim() ? { displayName: cfg.displayName.trim() } : {}),
        // appendPersona only matters when a custom persona is present, so only send it then.
        ...(cfg.persona.trim() ? { persona: cfg.persona.trim(), appendPersona: cfg.appendPersona } : {}),
      };
    }
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        team,
        remoteE2e,
        ...(rules.trim() ? { rules: rules.trim() } : {}),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "failed to create team");
      return;
    }
    await Promise.all([reloadProjects(), reloadAgents()]);
    onClose();
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 600 }}>New coding team</h2>
      <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} style={{ ...input, width: "100%", marginBottom: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ROLES.map((r) => {
          const rc = roles[r.role];
          const on = r.optional ? rc.enabled : true;
          return (
            <div key={r.role} style={{ display: "flex", flexDirection: "column", gap: 6, opacity: on ? 1 : 0.55 }}>
              <div style={roleRow}>
                <div style={{ width: 150, display: "flex", alignItems: "center", gap: 6 }}>
                  {r.optional && (
                    <input
                      type="checkbox"
                      checked={rc.enabled}
                      title={`Include ${r.label}`}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], enabled: checked } }));
                        if (!checked) setExpanded((s) => ({ ...s, [r.role]: false }));
                      }}
                    />
                  )}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{r.label}</div>
                    <div style={{ fontSize: 10, color: "rgb(var(--muted))" }}>{r.blurb}</div>
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <ModelSelect
                    models={settings.models}
                    kind="chat"
                    value={rc.modelId}
                    disabled={!on}
                    onChange={(v) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], modelId: v } }))}
                  />
                </div>
                {r.defaultTool && (
                  <select
                    value={rc.tool}
                    disabled={!on}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], tool: e.target.value as ToolChoice } }))}
                    style={{ ...input, width: 150 }}
                  >
                    <option value="model">normal agent (no CLI)</option>
                    {CODING_TOOLS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  style={{ ...ghostBtn, padding: "4px 8px" }}
                  disabled={!on}
                  onClick={() => setExpanded((s) => ({ ...s, [r.role]: !s[r.role] }))}
                >
                  {expanded[r.role] ? "Hide" : "Customize"}
                </button>
              </div>
              {on && expanded[r.role] && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 24 }}>
                  <input
                    placeholder={`Display name (default: ${r.label})`}
                    value={rc.displayName}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], displayName: e.target.value } }))}
                    style={{ ...input, width: "100%" }}
                  />
                  <textarea
                    placeholder="Custom persona (blank = use this role's default)"
                    value={rc.persona}
                    onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], persona: e.target.value } }))}
                    rows={3}
                    style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
                  />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgb(var(--muted))" }}>
                    <input
                      type="checkbox"
                      checked={rc.appendPersona}
                      onChange={(e) => setRoles((s) => ({ ...s, [r.role]: { ...s[r.role], appendPersona: e.target.checked } }))}
                    />
                    Append to this role's default persona
                  </label>
                  {!rc.appendPersona && rc.persona.trim() && (
                    <div style={warnText}>
                      ⚠️ Replacing the default persona removes the role's built-in instructions (how it plans, uses its
                      CLI, and coordinates with teammates). The role may not behave correctly — appending is recommended.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Project rules (optional)</div>
        <textarea
          data-testid="team-rules"
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder={`Standing rules for the team — e.g.\nAlways commit to dev.\nFollow the existing code style.`}
          rows={4}
          style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 12 }}>
        <input type="checkbox" checked={remoteE2e} onChange={(e) => setRemoteE2e(e.target.checked)} />
        Remote end-to-end testing (needs the Proxmox + SSH service agents)
      </label>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", marginTop: 10 }}>
        Pick <strong>normal agent (no CLI)</strong> to have a coding role work directly with just its model —
        no CLI to install. Pick a CLI (claude/codex/gemini/opencode) to use that subscription
        instead; you'll log it in from the agent's terminal once. Leave a model blank to inherit the
        default. The tester always runs the suite locally in <code>/project</code>; leave{" "}
        <strong>Remote end-to-end testing</strong> off to skip the VM/SSH run, or turn it on (and add
        the Proxmox/SSH infrastructure agents) to also test on a clean VM.
      </p>
      {error && <div style={{ color: "rgb(var(--danger))", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={primaryBtn} disabled={busy || !name.trim()} onClick={() => void create()}>
          {busy ? "Creating…" : "Create team"}
        </button>
      </div>
    </div>
  );
}

function ServiceForm({ onClose }: { onClose: () => void }) {
  const settings = useGlobalSettingsStore((s) => s.settings);
  const loadSettings = useGlobalSettingsStore((s) => s.load);
  const reloadAgents = useAgentsStore((s) => s.load);
  const [kinds, setKinds] = useState<{ proxmox: boolean; ssh: boolean }>({ proxmox: true, ssh: true });
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const create = async () => {
    const chosen = (["proxmox", "ssh"] as const).filter((k) => kinds[k]);
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    for (const kind of chosen) {
      const res = await apiFetch("/api/service-agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, modelId: modelId || undefined }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? `failed to create ${kind} agent`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    await reloadAgents();
    onClose();
  };

  return (
    <div>
      <h2 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 600 }}>Infrastructure agents</h2>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, marginTop: 0 }}>
        Shared, instance-wide agents that project testers delegate to. Configure their VM/host
        allowlists + credentials afterward in each agent's Configure panel.
      </p>
      <label style={checkRow}>
        <input type="checkbox" checked={kinds.proxmox} onChange={(e) => setKinds({ ...kinds, proxmox: e.target.checked })} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Proxmox agent</div>
          <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Start / stop / snapshot / roll back VMs.</div>
        </div>
      </label>
      <label style={checkRow}>
        <input type="checkbox" checked={kinds.ssh} onChange={(e) => setKinds({ ...kinds, ssh: e.target.checked })} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>SSH agent</div>
          <div style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Run commands on allowlisted hosts.</div>
        </div>
      </label>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Model</div>
        <ModelSelect models={settings.models} kind="chat" value={modelId} onChange={setModelId} />
      </div>
      {error && <div style={{ color: "rgb(var(--danger))", fontSize: 12, marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button style={ghostBtn} onClick={onClose}>Cancel</button>
        <button style={primaryBtn} disabled={busy || (!kinds.proxmox && !kinds.ssh)} onClick={() => void create()}>
          {busy ? "Creating…" : "Create"}
        </button>
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
  width: "min(92vw, 620px)",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};
const card: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  cursor: "pointer",
};
const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};
const warnText: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.4,
  color: "rgb(var(--warning))",
  background: "rgb(var(--warning-bg))",
  border: "1px solid rgb(var(--warning) / 0.3)",
  borderRadius: 6,
  padding: "6px 8px",
};
const roleRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 8,
};
const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 10,
  marginTop: 8,
  cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "rgb(var(--accent-fg))",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 12px",
  cursor: "pointer",
  fontSize: 13,
};
const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  color: "rgb(var(--muted))",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
  marginBottom: 8,
};
